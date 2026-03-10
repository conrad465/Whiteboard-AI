import type {
  CanvasPosition,
  RelativeElementPosition,
  ConnectedPosition,
  WhiteboardElement,
  AnchorPoint,
  RelativePlacement,
  ShapeAnchor,
} from "../schema/types";
import type { ResolvedGeometry, LiveElement, SceneGraph } from "./SceneGraph";

// -----------------------------------------------------------------------------
// Anchor → offset from top-left corner of element's bounding box
// -----------------------------------------------------------------------------

function anchorToOffset(
  anchor: AnchorPoint,
  width: number,
  height: number
): { x: number; y: number } {
  const half_w = width / 2;
  const half_h = height / 2;
  const map: Record<AnchorPoint, { x: number; y: number }> = {
    center:       { x: half_w, y: half_h },
    top:          { x: half_w, y: 0       },
    bottom:       { x: half_w, y: height  },
    left:         { x: 0,      y: half_h  },
    right:        { x: width,  y: half_h  },
    top_left:     { x: 0,      y: 0       },
    top_right:    { x: width,  y: 0       },
    bottom_left:  { x: 0,      y: height  },
    bottom_right: { x: width,  y: height  },
  };
  return map[anchor];
}

// -----------------------------------------------------------------------------
// Placement direction vectors
// dx: +1 = right, -1 = left, 0 = no horizontal displacement
// dy: +1 = down,  -1 = up,   0 = no vertical displacement
// -----------------------------------------------------------------------------

const PLACEMENT_VECTORS: Record<RelativePlacement, { dx: number; dy: number }> = {
  right_of:        { dx:  1, dy:  0 },
  left_of:         { dx: -1, dy:  0 },
  above:           { dx:  0, dy: -1 },
  below:           { dx:  0, dy:  1 },
  top_right_of:    { dx:  1, dy: -1 },
  top_left_of:     { dx: -1, dy: -1 },
  bottom_right_of: { dx:  1, dy:  1 },
  bottom_left_of:  { dx: -1, dy:  1 },
  center_of:       { dx:  0, dy:  0 },
  overlapping:     { dx:  0, dy:  0 },
};

// -----------------------------------------------------------------------------
// PositionResolver
// -----------------------------------------------------------------------------

export class PositionResolver {
  private canvasWidth: number;
  private canvasHeight: number;
  private sceneGraph: SceneGraph;

  constructor(canvasWidth: number, canvasHeight: number, sceneGraph: SceneGraph) {
    this.canvasWidth  = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.sceneGraph   = sceneGraph;
  }

  updateCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  resolve(element: WhiteboardElement): ResolvedGeometry {
    const width = element.element_type === "shape"
      ? (element.width_percent / 100) * this.canvasWidth
      : ((element.max_width_percent ?? 30) / 100) * this.canvasWidth;
    const height = (("height_percent" in element ? element.height_percent : 10) / 100) * this.canvasHeight;
    const rotation = ("rotation_degrees" in element ? element.rotation_degrees : 0) ?? 0;

    if (element.position.type === "canvas") {
      return this.resolveCanvas(element.position, width, height, rotation);
    } else if (element.position.type === "connected") {
      return this.resolveConnected(element.position, height, element.id);
    } else {
      return this.resolveRelative(element.position, width, height, rotation, element.id);
    }
  }

  private resolveCanvas(
    pos: CanvasPosition,
    width: number,
    height: number,
    rotation: number
  ): ResolvedGeometry {
    const offset = anchorToOffset(pos.anchor, width, height);
    const cx = (pos.x_percent / 100) * this.canvasWidth;
    const cy = (pos.y_percent / 100) * this.canvasHeight;
    return {
      x: cx - offset.x,
      y: cy - offset.y,
      width,
      height,
      rotation,
    };
  }

  private resolveRelative(
    pos: RelativeElementPosition,
    width: number,
    height: number,
    rotation: number,
    selfId: string
  ): ResolvedGeometry {
    const ref = this.sceneGraph.getElement(pos.relative_to);
    if (!ref) {
      throw new Error(
        `PositionResolver: element "${selfId}" references unknown element "${pos.relative_to}". ` +
        `Ensure the referenced element is created earlier in the actions list.`
      );
    }

    const rg = ref.resolved;
    const gap = ((pos.gap_percent ?? 2) / 100) * Math.min(this.canvasWidth, this.canvasHeight);
    const { dx, dy } = PLACEMENT_VECTORS[pos.placement];

    let x: number;
    let y: number;

    if (pos.placement === "center_of" || pos.placement === "overlapping") {
      // Center this element over the reference
      x = rg.x + rg.width  / 2 - width  / 2;
      y = rg.y + rg.height / 2 - height / 2;
    } else if (Math.abs(dx) > 0 && Math.abs(dy) === 0) {
      // Pure horizontal placement (right_of / left_of)
      x = dx > 0
        ? rg.x + rg.width + gap        // place to the right
        : rg.x - width - gap;          // place to the left

      // Secondary-axis: vertical alignment
      y = this.secondaryAlign("y", pos.align, rg, height);
    } else if (Math.abs(dy) > 0 && Math.abs(dx) === 0) {
      // Pure vertical placement (above / below)
      y = dy > 0
        ? rg.y + rg.height + gap       // place below
        : rg.y - height - gap;         // place above

      // Secondary-axis: horizontal alignment
      x = this.secondaryAlign("x", pos.align, rg, width);
    } else {
      // Diagonal placement (top_right_of etc.)
      x = dx > 0
        ? rg.x + rg.width + gap
        : rg.x - width - gap;
      y = dy > 0
        ? rg.y + rg.height + gap
        : rg.y - height - gap;
    }

    return { x, y, width, height, rotation };
  }

  // ---------------------------------------------------------------------------
  // Connected positioning — arrow between two shape anchor points
  // ---------------------------------------------------------------------------

  private resolveConnected(
    pos: ConnectedPosition,
    height: number,
    selfId: string
  ): ResolvedGeometry {
    const fromEl = this.sceneGraph.getElement(pos.from_element);
    const toEl   = this.sceneGraph.getElement(pos.to_element);

    if (!fromEl) throw new Error(`PositionResolver: "${selfId}" connected from unknown element "${pos.from_element}"`);
    if (!toEl)   throw new Error(`PositionResolver: "${selfId}" connected to unknown element "${pos.to_element}"`);

    const a = this.getAnchorPoint(fromEl, pos.from_anchor);
    const b = this.getAnchorPoint(toEl,   pos.to_anchor);

    const dx       = b.x - a.x;
    const dy       = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const rotation = Math.atan2(dy, dx) * (180 / Math.PI);

    // Place bounding box centered on midpoint; rotation is applied around center
    return {
      x:        (a.x + b.x) / 2 - distance / 2,
      y:        (a.y + b.y) / 2 - height   / 2,
      width:    distance,
      height,
      rotation,
    };
  }

  private getAnchorPoint(el: LiveElement, anchor: ShapeAnchor): { x: number; y: number } {
    const { x, y, width: w, height: h } = el.resolved;
    const def = el.definition;

    if (def.element_type !== "shape") {
      return { x: x + w / 2, y: y + h / 2 };
    }

    switch (def.shape) {
      case "rectangle": return this.getRectAnchor(x, y, w, h, anchor);
      case "triangle":  return this.getTriangleAnchor(x, y, w, h, anchor);
      case "circle":    return this.getCircleAnchor(x + w / 2, y + h / 2, w / 2, h / 2, anchor);
      default:          return { x: x + w / 2, y: y + h / 2 };
    }
  }

  private getRectAnchor(x: number, y: number, w: number, h: number, anchor: ShapeAnchor): { x: number; y: number } {
    switch (anchor) {
      case "top_left":     return { x,            y            };
      case "top":          return { x: x + w / 2, y            };
      case "top_right":    return { x: x + w,     y            };
      case "left":         return { x,            y: y + h / 2 };
      case "center":       return { x: x + w / 2, y: y + h / 2 };
      case "right":        return { x: x + w,     y: y + h / 2 };
      case "bottom_left":  return { x,            y: y + h     };
      case "bottom":       return { x: x + w / 2, y: y + h     };
      case "bottom_right": return { x: x + w,     y: y + h     };
      default:             return { x: x + w / 2, y: y + h / 2 };
    }
  }

  private getTriangleAnchor(x: number, y: number, w: number, h: number, anchor: ShapeAnchor): { x: number; y: number } {
    switch (anchor) {
      case "apex":         return { x: x + w / 2, y               };
      case "bottom_left":  return { x,            y: y + h        };
      case "bottom_right": return { x: x + w,     y: y + h        };
      case "left_edge":    return { x: x + w / 4, y: y + h / 2   }; // midpoint(apex, bottom_left)
      case "right_edge":   return { x: x + 3*w/4, y: y + h / 2   }; // midpoint(apex, bottom_right)
      case "bottom":       return { x: x + w / 2, y: y + h        }; // midpoint(bottom_left, bottom_right)
      case "center":       return { x: x + w / 2, y: y + h * 2/3 }; // centroid at 2/3 height
      default:             return { x: x + w / 2, y: y + h / 2   };
    }
  }

  private getCircleAnchor(cx: number, cy: number, rx: number, ry: number, anchor: ShapeAnchor): { x: number; y: number } {
    const D = Math.SQRT1_2; // cos(45°) = sin(45°) = √2/2
    switch (anchor) {
      case "N":      return { x: cx,           y: cy - ry         };
      case "NE":     return { x: cx + rx * D,  y: cy - ry * D     };
      case "E":      return { x: cx + rx,       y: cy              };
      case "SE":     return { x: cx + rx * D,  y: cy + ry * D     };
      case "S":      return { x: cx,           y: cy + ry         };
      case "SW":     return { x: cx - rx * D,  y: cy + ry * D     };
      case "W":      return { x: cx - rx,       y: cy              };
      case "NW":     return { x: cx - rx * D,  y: cy - ry * D     };
      case "center": return { x: cx,           y: cy              };
      default:       return { x: cx,           y: cy              };
    }
  }

  /**
   * Compute the secondary-axis coordinate so that this element is aligned
   * with the reference element according to the given anchor.
   * Defaults to center-alignment if no anchor is specified.
   */
  private secondaryAlign(
    axis: "x" | "y",
    anchor: AnchorPoint | undefined,
    ref: ResolvedGeometry,
    size: number
  ): number {
    if (!anchor) {
      // Default: center-align on secondary axis
      return axis === "x"
        ? ref.x + ref.width  / 2 - size / 2
        : ref.y + ref.height / 2 - size / 2;
    }

    if (axis === "x") {
      const isLeft   = anchor === "left"   || anchor === "top_left"    || anchor === "bottom_left";
      const isRight  = anchor === "right"  || anchor === "top_right"   || anchor === "bottom_right";
      if (isLeft)  return ref.x;
      if (isRight) return ref.x + ref.width - size;
      return ref.x + ref.width / 2 - size / 2;
    } else {
      const isTop    = anchor === "top"    || anchor === "top_left"    || anchor === "top_right";
      const isBottom = anchor === "bottom" || anchor === "bottom_left" || anchor === "bottom_right";
      if (isTop)    return ref.y;
      if (isBottom) return ref.y + ref.height - size;
      return ref.y + ref.height / 2 - size / 2;
    }
  }
}
