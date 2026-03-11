// =============================================================================
// Stock & Flow Scene Type — LLM Input Schema
// Version 0.1
// =============================================================================

import type { NamedColor } from "../../schema/types";

export interface StockFlowScene {
  scene_type: "stock_and_flow";
  version: "0.1";
  title: string;
  colors?: ColorScheme;
  transcript: string;
  system: SystemDefinition;
  narrative: NarrativeBeat[];
}

export interface ColorScheme {
  stock?: NamedColor;
  inflow?: NamedColor;
  outflow?: NamedColor;
  converter?: NamedColor;
  connector?: NamedColor;
}

export const DEFAULT_COLORS: Required<ColorScheme> = {
  stock: "blue",
  inflow: "green",
  outflow: "red",
  converter: "purple",
  connector: "orange",
};

export interface SystemDefinition {
  stocks: Stock[];
  flows: Flow[];
  converters?: Converter[];
  connectors?: Connector[];
}

export interface Stock {
  id: string;
  label: string;
}

export interface Flow {
  id: string;
  label: string;
  type: "inflow" | "outflow";
  to_stock?: string;
  from_stock?: string;
}

export interface Converter {
  id: string;
  label: string;
}

export interface Connector {
  from: string;
  to: string;
  label?: string;
}

export interface NarrativeBeat {
  trigger_phrase: string;
  action: "enter" | "emphasize" | "exit";
  targets: string[];
}

// =============================================================================
// Internal layout types — computed by the engine, not specified by the LLM
// =============================================================================

export type VisualElementType =
  | "title"
  | "stock"
  | "flow"
  | "cloud"
  | "converter"
  | "connector"
  | "flow_label";

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
  /** Label text (if any) */
  label?: string;
  /** Current visual state */
  state: ElementVisualState;
  /** Animation progress 0–1 */
  progress: number;
  /** Opacity 0–1 */
  opacity: number;
  /** Scale factor (for pop/pulse/shrink) */
  scale: number;
  /** For typewrite: visible character count */
  visibleChars?: number;
  /** For draw: clip progress 0–1 */
  drawProgress?: number;

  // --- Type-specific layout data ---

  /** For flow: pipe start and end points */
  pipeStart?: { x: number; y: number };
  pipeEnd?: { x: number; y: number };
  /** For flow: valve midpoint */
  valveMid?: { x: number; y: number };
  /** For flow: pipe thickness in pixels */
  pipeThickness?: number;
  /** For flow: the color for the flow type */
  flowColor?: string;

  /** For cloud: associated flow id */
  flowId?: string;
  /** For cloud: the cloud circles (offsets from center) */
  cloudCircles?: { cx: number; cy: number; r: number }[];
  /** For cloud: border color */
  borderColor?: string;

  /** For connector: Bezier curve control points */
  curveStart?: { x: number; y: number };
  curveEnd?: { x: number; y: number };
  curveControl?: { x: number; y: number };
  /** For connector: arrowhead angle */
  arrowAngle?: number;

  /** For flow_label: text color (may differ from fill) */
  textColor?: string;
}
