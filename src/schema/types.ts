// =============================================================================
// WHITEBOARD AI — Framework Schema Types
// Version 1.0
//
// This file is the LLM contract. Every scene definition JSON must conform to
// the types defined here. Keep property names descriptive and human-readable.
// =============================================================================

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

export type NamedColor =
  | "white"
  | "black"
  | "red"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "purple";

export type ShapeType =
  | "rectangle"
  | "triangle"
  | "circle"
  | "line"
  | "arrow";

export type AnchorPoint =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right";

export type RelativePlacement =
  | "right_of"
  | "left_of"
  | "above"
  | "below"
  | "top_right_of"
  | "top_left_of"
  | "bottom_right_of"
  | "bottom_left_of"
  | "center_of"
  | "overlapping";

export type FontSize = "small" | "medium" | "large" | "xlarge";

// -----------------------------------------------------------------------------
// Positioning — two modes, no pixel math required
// -----------------------------------------------------------------------------

/**
 * Place the element's own anchor point at (x_percent, y_percent) of the canvas.
 * Example: { type:"canvas", x_percent:50, y_percent:50, anchor:"center" }
 * places the element's center at the center of the canvas.
 */
export interface CanvasPosition {
  type: "canvas";
  /** 0–100: horizontal position as a percentage of canvas width */
  x_percent: number;
  /** 0–100: vertical position as a percentage of canvas height */
  y_percent: number;
  /** Which point of THIS element is placed at (x_percent, y_percent) */
  anchor: AnchorPoint;
}

/**
 * Place the element relative to another named element.
 * Example: { type:"relative", relative_to:"house_body", placement:"above", gap_percent:0, align:"center" }
 * places the element directly above the house_body, horizontally centered.
 *
 * IMPORTANT: The referenced element must be created BEFORE this one in the actions list.
 */
export interface RelativeElementPosition {
  type: "relative";
  /** ID of the element to position relative to */
  relative_to: string;
  /** Where to place this element relative to the reference */
  placement: RelativePlacement;
  /** Gap between this element and the reference, as % of canvas min-dimension (default: 2) */
  gap_percent?: number;
  /** Secondary-axis alignment (e.g., align tops when using right_of). Default: center */
  align?: AnchorPoint;
}

export type Position = CanvasPosition | RelativeElementPosition;

// -----------------------------------------------------------------------------
// Elements
// -----------------------------------------------------------------------------

export interface ShapeElement {
  id: string;
  element_type: "shape";
  shape: ShapeType;
  /** Width as a percentage of canvas width (0–100) */
  width_percent: number;
  /** Height as a percentage of canvas height (0–100) */
  height_percent: number;
  fill_color: NamedColor;
  border_color: NamedColor;
  /** Border stroke width in pixels. Default: 2 */
  border_width?: number;
  /** Clockwise rotation in degrees. Default: 0 */
  rotation_degrees?: number;
  position: Position;
  /** Runtime only — do not set in JSON */
  opacity?: number;
}

export interface TextElement {
  id: string;
  element_type: "text";
  content: string;
  font_size: FontSize;
  color: NamedColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Max text wrap width as % of canvas width. Default: 20 */
  max_width_percent?: number;
  position: Position;
  /** Runtime only — do not set in JSON */
  opacity?: number;
}

export type WhiteboardElement = ShapeElement | TextElement;

// -----------------------------------------------------------------------------
// Animations
// -----------------------------------------------------------------------------

export interface FadeInAnimation {
  type: "fade_in";
  easing?: "linear" | "ease_in" | "ease_out" | "ease_in_out";
}

/** Scale 0 → 1.15 → 1.0 with a spring overshoot. Good for new elements. */
export interface PopInAnimation {
  type: "pop_in";
}

/**
 * Scale 1 → 1.2 → 1.0. Element stays visible (opacity=1).
 * Use for EDIT actions to signal that a property changed.
 */
export interface PopHighlightAnimation {
  type: "pop_highlight";
}

/** Reveal the shape by expanding a clip rect from left-to-right or top-to-bottom. */
export interface DrawInAnimation {
  type: "draw_in";
  direction?: "left_to_right" | "top_to_bottom";
}

/** Reveal text one character at a time. Only valid for TextElement. */
export interface TypewriterAnimation {
  type: "typewriter";
}

export type AnimationConfig =
  | FadeInAnimation
  | PopInAnimation
  | PopHighlightAnimation
  | DrawInAnimation
  | TypewriterAnimation;

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/**
 * Create a new element.
 * The animation starts when TTS speaks the first word of trigger_phrase
 * and completes when TTS finishes the last word of trigger_phrase.
 * Multiple create actions can share the same trigger_phrase.
 */
export interface CreateAction {
  action_id: string;
  action_type: "create";
  /** Exact substring of the scene's transcript. Case-sensitive. */
  trigger_phrase: string;
  element: WhiteboardElement;
  /** If omitted, the scene's default_animation is used */
  animation?: AnimationConfig;
}

/**
 * Edit properties of an existing element.
 * Only the fields in `changes` are updated; all other fields stay the same.
 * Default animation is pop_highlight (scale up/down to draw attention to the change).
 */
export interface EditAction {
  action_id: string;
  action_type: "edit";
  trigger_phrase: string;
  element_id: string;
  changes: Partial<Omit<ShapeElement, "id" | "element_type"> & Omit<TextElement, "id" | "element_type">>;
  animation?: AnimationConfig;
}

/**
 * Remove an element from the scene.
 * The element fades out over the trigger phrase duration, then is removed.
 */
export interface DeleteAction {
  action_id: string;
  action_type: "delete";
  trigger_phrase: string;
  element_id: string;
}

export type WhiteboardAction = CreateAction | EditAction | DeleteAction;

// -----------------------------------------------------------------------------
// Scene — top-level document
// -----------------------------------------------------------------------------

export interface CanvasConfig {
  aspect_ratio: "16:9" | "4:3" | "1:1";
  background_color: NamedColor;
}

/**
 * The top-level scene definition. This is what an LLM generates.
 *
 * Rules:
 * - trigger_phrase values must be exact substrings of transcript
 * - Elements referenced via relative positioning must appear in actions earlier
 *   in the array (dependency order)
 * - action_id values must be unique
 * - element id values must be unique
 */
export interface SceneDefinition {
  version: "1.0";
  title?: string;
  canvas: CanvasConfig;
  /** The full text to be read aloud by the text-to-speech engine */
  transcript: string;
  /** Default animation used when an action doesn't specify one */
  default_animation: AnimationConfig;
  actions: WhiteboardAction[];
}
