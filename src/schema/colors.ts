import type { NamedColor, FontSize } from "./types";

/**
 * Maps NamedColor values to CSS color strings.
 * Chosen to look like whiteboard markers: high contrast, slightly saturated.
 */
export const COLOR_MAP: Record<NamedColor, string> = {
  white:  "#FFFFFF",
  black:  "#1A1A1A",
  red:    "#E53935",
  blue:   "#1E88E5",
  green:  "#43A047",
  yellow: "#FDD835",
  orange: "#FB8C00",
  purple: "#8E24AA",
};

/**
 * Maps FontSize tokens to pixel values.
 * Designed to be legible on a whiteboard at typical viewing distances.
 */
export const FONT_SIZE_MAP: Record<FontSize, number> = {
  small:  16,
  medium: 24,
  large:  36,
  xlarge: 52,
};

/**
 * The whiteboard font stack. Prefers handwriting/chalk-style fonts.
 * Falls back to system fonts that look somewhat informal.
 */
export const WHITEBOARD_FONT_FAMILY =
  '"Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive, sans-serif';
