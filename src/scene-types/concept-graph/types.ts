// =============================================================================
// Concept Graph Scene Type — LLM Input Schema + Internal Types
// Version 0.2
// =============================================================================

import type { NamedColor } from "../../schema/types";

// ---------------------------------------------------------------------------
// LLM Input Schema (what the LLM produces)
// ---------------------------------------------------------------------------

export interface ConceptGraphScene {
  scene_type: "concept_graph";
  version: "0.2";
  title: string;
  style?: StyleConfig;
  transcript: string;
  graph: GraphDefinition;
  narrative: NarrativeBeat[];
}

export interface StyleConfig {
  palette?: NamedColor;
  edge_color?: NamedColor;
}

export const DEFAULT_STYLE: Required<StyleConfig> = {
  palette: "blue",
  edge_color: "gray",
};

export interface GraphDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  group?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface NarrativeBeat {
  trigger_phrase: string;
  action: "enter" | "emphasize" | "exit";
  targets: string[];
}

// ---------------------------------------------------------------------------
// Internal layout types — computed by the engine, not specified by the LLM
// ---------------------------------------------------------------------------

export type VisualElementType = "title" | "node" | "edge" | "edge_label";

export type ElementVisualState = "hidden" | "animating" | "visible";

export interface VisualElement {
  id: string;
  type: VisualElementType;
  /** Bounding box in canvas pixels */
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS hex color for fill */
  color: string;
  /** Label text */
  label?: string;
  /** Current visual state */
  state: ElementVisualState;
  /** Animation progress 0-1 */
  progress: number;
  /** Opacity 0-1 */
  opacity: number;
  /** Scale factor (for pop/pulse/shrink) */
  scale: number;
  /** For typewrite: visible character count */
  visibleChars?: number;
  /** For draw: clip progress 0-1 */
  drawProgress?: number;

  // --- Node-specific ---
  /** Border color */
  borderColor?: string;
  /** Auto-contrast text color */
  textColor?: string;

  // --- Edge-specific ---
  /** Edge start point (on source box border) */
  edgeStart?: { x: number; y: number };
  /** Edge end point (on target box border) */
  edgeEnd?: { x: number; y: number };
  /** Bezier control point (for curved edges) */
  edgeControl?: { x: number; y: number };
  /** Whether edge is curved (vs straight) */
  isCurved?: boolean;
  /** Arrow angle at the target end */
  arrowAngle?: number;
  /** Source node id */
  fromNodeId?: string;
  /** Target node id */
  toNodeId?: string;
  /** Whether this edge was reversed for cycle-breaking */
  isReversed?: boolean;
}
