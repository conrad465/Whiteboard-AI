import type { WhiteboardElement } from "../schema/types";

// -----------------------------------------------------------------------------
// ResolvedGeometry — absolute pixel coordinates on the canvas
// -----------------------------------------------------------------------------

export interface ResolvedGeometry {
  x: number;       // canvas pixels, top-left corner of element's bounding box
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
}

// -----------------------------------------------------------------------------
// LiveElement — runtime state of a single element
// -----------------------------------------------------------------------------

export type ElementState = "hidden" | "animating" | "visible" | "deleted";

export interface LiveElement {
  /** The element's definition (can be mutated by EditAction) */
  definition: WhiteboardElement;
  /** Resolved absolute pixel geometry */
  resolved: ResolvedGeometry;
  /** Lifecycle state driven by AnimationController */
  state: ElementState;
  /** Current opacity 0–1, driven by AnimationController */
  opacity: number;
  /** 0–1 animation progress, driven by AnimationController */
  animationProgress: number;
  /** Current scale factor for pop animations. 1.0 = normal size */
  scale: number;
  /** For typewriter animation: how many characters to render */
  visibleChars?: number;
  /** For draw_in animation: 0–1 clip progress */
  drawProgress?: number;
}

// -----------------------------------------------------------------------------
// SceneGraph — the authoritative store of all live elements
// -----------------------------------------------------------------------------

export class SceneGraph {
  /** Insertion order is maintained for paint z-ordering */
  private elements = new Map<string, LiveElement>();

  addElement(definition: WhiteboardElement, resolved: ResolvedGeometry): void {
    if (this.elements.has(definition.id)) {
      console.warn(`SceneGraph: element "${definition.id}" already exists — replacing`);
    }
    this.elements.set(definition.id, {
      definition,
      resolved,
      state: "hidden",
      opacity: 0,
      animationProgress: 0,
      scale: 1,
    });
  }

  getElement(id: string): LiveElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Apply a partial property patch to an element's definition.
   * Position changes are NOT re-resolved here — call PositionResolver separately
   * if you need to update geometry.
   */
  updateElement(id: string, changes: Partial<WhiteboardElement>): void {
    const el = this.elements.get(id);
    if (!el) {
      console.warn(`SceneGraph: updateElement called on unknown id "${id}"`);
      return;
    }
    // Deep merge: spread existing definition then apply changes
    el.definition = { ...el.definition, ...changes } as WhiteboardElement;
  }

  updateGeometry(id: string, resolved: ResolvedGeometry): void {
    const el = this.elements.get(id);
    if (!el) return;
    el.resolved = resolved;
  }

  markDeleted(id: string): void {
    const el = this.elements.get(id);
    if (el) el.state = "deleted";
  }

  hardDelete(id: string): void {
    this.elements.delete(id);
  }

  /** Returns all non-deleted elements in insertion (z) order */
  getAllVisible(): LiveElement[] {
    const result: LiveElement[] = [];
    for (const el of this.elements.values()) {
      if (el.state !== "deleted") {
        result.push(el);
      }
    }
    return result;
  }

  /** Returns IDs in insertion order (for z-ordering logic) */
  getZOrder(): string[] {
    return Array.from(this.elements.keys());
  }

  /** Returns all element IDs (including deleted) */
  getAllIds(): string[] {
    return Array.from(this.elements.keys());
  }

  clear(): void {
    this.elements.clear();
  }
}
