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
  gray:   "#757575",
};

/**
 * Maps FontSize tokens to pixel values.
 * Designed to be legible on a whiteboard at typical viewing distances.
 */
export const FONT_SIZE_MAP: Record<FontSize, number> = {
  small:  12,
  medium: 18,
  large:  28,
  xlarge: 40,
};

/**
 * The whiteboard font stack. Prefers handwriting/chalk-style fonts.
 * Falls back to system fonts that look somewhat informal.
 */
export const WHITEBOARD_FONT_FAMILY =
  '"Segoe Print", "Chalkboard SE", "Comic Sans MS", cursive, sans-serif';

// -----------------------------------------------------------------------------
// Color utilities — used by flash (brighten) and morph (interpolate)
// -----------------------------------------------------------------------------

/** Parse a hex color (#RRGGBB) to [r, g, b] in 0–255. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Convert [r, g, b] (0–255) to [h, s, l] where h=0–360, s,l=0–1. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** Convert [h, s, l] (h=0–360, s,l=0–1) to CSS hex string. */
function hslToHex(h: number, s: number, l: number): string {
  h /= 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Brighten a CSS hex color by the given amount (0–1).
 * Used by the flash emphasis animation.
 */
export function brightenColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = Math.min(l + amount * (1 - l), 1);
  return hslToHex(h, s, newL);
}

/**
 * Interpolate between two CSS hex colors through HSL space.
 * t = 0 returns colorA, t = 1 returns colorB.
 * Used by the morph transform animation for color transitions.
 */
export function interpolateColor(hexA: string, hexB: string, t: number): string {
  const [rA, gA, bA] = hexToRgb(hexA);
  const [hA, sA, lA] = rgbToHsl(rA, gA, bA);
  const [rB, gB, bB] = hexToRgb(hexB);
  const [hB, sB, lB] = rgbToHsl(rB, gB, bB);

  // Shortest-path hue interpolation
  let dh = hB - hA;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;

  const h = hA + dh * t;
  const s = sA + (sB - sA) * t;
  const l = lA + (lB - lA) * t;
  return hslToHex(((h % 360) + 360) % 360, s, l);
}
