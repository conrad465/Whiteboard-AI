import type {
  CanvasPosition,
  RelativeElementPosition,
  WhiteboardElement,
  AnchorPoint,
  RelativePlacement,
} from "../schema/types";
import type { ResolvedGeometry, SceneGraph } from "./SceneGraph";

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
    const width  = (("width_percent"  in element ? element.width_percent  : 20) / 100) * this.canvasWidth;
    const height = (("height_percent" in element ? element.height_percent : 10) / 100) * this.canvasHeight;
    const rotation = ("rotation_degrees" in element ? element.rotation_degrees : 0) ?? 0;

    if (element.position.type === "canvas") {
      return this.resolveCanvas(element.position, width, height, rotation);
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
