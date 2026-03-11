import type { AnimationConfig } from "../schema/types";
import type { LiveElement, SceneGraph } from "./SceneGraph";
import type { Renderer } from "./Renderer";
import { COLOR_MAP, brightenColor, interpolateColor } from "../schema/colors";

// -----------------------------------------------------------------------------
// Normalized animation — internal representation after legacy mapping
// -----------------------------------------------------------------------------

type NormalizedType =
  | "fade_enter" | "pop" | "draw" | "typewrite"   // enter
  | "pulse" | "flash"                              // emphasize
  | "morph"                                        // transform
  | "fade_exit" | "shrink";                        // exit

type NormalizedEasing = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "spring";

interface NormalizedAnimation {
  type: NormalizedType;
  easing: NormalizedEasing;
  direction?: "left_to_right" | "top_to_bottom";
}

/**
 * Maps any AnimationConfig (v1.0 legacy or v1.1) to a normalized internal form.
 * This is the single place where backward compatibility is handled.
 */
function normalize(config: AnimationConfig, isDeleting: boolean): NormalizedAnimation {
  switch (config.type) {
    // --- v1.1 primitives ---
    case "fade":
      if ("category" in config && config.category === "exit") {
        return { type: "fade_exit", easing: "ease_in" };
      }
      return { type: "fade_enter", easing: "ease_out" };
    case "pop":
      return { type: "pop", easing: "spring" };
    case "draw":
      return { type: "draw", easing: "linear", direction: "direction" in config ? config.direction : undefined };
    case "typewrite":
      return { type: "typewrite", easing: "linear" };
    case "pulse":
      return { type: "pulse", easing: "spring" };
    case "flash":
      return { type: "flash", easing: "ease_out" };
    case "morph":
      return { type: "morph", easing: "ease_out" };
    case "shrink":
      return { type: "shrink", easing: "ease_in" };

    // --- v1.0 legacy ---
    case "fade_in":
      if (isDeleting) return { type: "fade_exit", easing: "ease_in" };
      return { type: "fade_enter", easing: config.easing ?? "ease_out" };
    case "pop_in":
      return { type: "pop", easing: "spring" };
    case "pop_highlight":
      return { type: "pulse", easing: "spring" };
    case "draw_in":
      return { type: "draw", easing: "linear", direction: config.direction };
    case "typewriter":
      return { type: "typewrite", easing: "linear" };

    default:
      return { type: "fade_enter", easing: "ease_out" };
  }
}

// -----------------------------------------------------------------------------
// ActiveAnimation — per-action animation state
// -----------------------------------------------------------------------------

interface ActiveAnimation {
  actionId: string;
  elementId: string;
  config: AnimationConfig;
  normalized: NormalizedAnimation;
  /** performance.now() when the animation started (trigger phrase first word) */
  startTime: number;
  /**
   * performance.now() when the animation should complete (trigger phrase last word).
   * null means we haven't heard the end word yet.
   */
  endTime: number | null;
  /**
   * Dynamically updated estimate of endTime, derived from mid-phrase word events.
   * Used by typewrite and draw to track speech timing without the hard soft-cap cliff.
   */
  estimatedEndTime: number | null;
  progress: number;   // 0→1
  isComplete: boolean;
  /** For delete/exit actions: element is being removed */
  isDeleting: boolean;
}

// Soft-cap: how far (0–1) to animate when end time hasn't fired yet,
// and how fast to get there (ms). This prevents elements appearing to "pause"
// mid-phrase because TTS boundary events are sparse.
const SOFTCAP_PROGRESS = 0.8;
const SOFTCAP_DURATION_MS = 600;

// Flash animation: how much to brighten (0–1)
const FLASH_BRIGHTNESS = 0.3;

// -----------------------------------------------------------------------------
// AnimationController
// -----------------------------------------------------------------------------

export class AnimationController {
  private active = new Map<string, ActiveAnimation>();
  private renderer: Renderer;
  private sceneGraph: SceneGraph;

  constructor(renderer: Renderer, sceneGraph: SceneGraph) {
    this.renderer   = renderer;
    this.sceneGraph = sceneGraph;
  }

  // ---------------------------------------------------------------------------
  // Public API — called by WhiteboardPlayer in response to BoundaryTracker events
  // ---------------------------------------------------------------------------

  /** Called when TTS reaches the first word of a CREATE or EDIT action's trigger phrase */
  onAnimationStart(
    actionId: string,
    elementId: string,
    config: AnimationConfig,
    isDeleting = false
  ): void {
    const normalized = normalize(config, isDeleting);

    this.active.set(actionId, {
      actionId,
      elementId,
      config,
      normalized,
      startTime: performance.now(),
      endTime: null,
      estimatedEndTime: null,
      progress: 0,
      isComplete: false,
      isDeleting,
    });

    const el = this.sceneGraph.getElement(elementId);
    if (!el) return;

    el.state = "animating";

    // Initialize animation starting state
    this.initStartState(el, normalized, isDeleting);
    this.renderer.markDirty();
  }

  /** Called when TTS passes the last word of an action's trigger phrase */
  onAnimationEnd(actionId: string): void {
    const anim = this.active.get(actionId);
    if (anim && !anim.isComplete) {
      anim.endTime = performance.now();
    }
  }

  /**
   * Called for each word boundary that falls within a trigger phrase.
   * charProgress (0→1) is the word's char offset within the phrase.
   * Updates estimatedEndTime so typewrite/draw can track speech
   * timing without relying on a fixed soft-cap.
   */
  onWordProgress(actionId: string, charProgress: number): void {
    const anim = this.active.get(actionId);
    if (!anim || anim.isComplete || anim.endTime !== null) return;

    const now     = performance.now();
    const elapsed = now - anim.startTime;

    // Need meaningful elapsed time before estimating; skip near-zero values
    if (charProgress > 0 && elapsed > 80) {
      anim.estimatedEndTime = anim.startTime + elapsed / charProgress;
    }
  }

  /** Called by WhiteboardPlayer every rAF tick */
  tick(now: number): void {
    let anyActive = false;

    for (const anim of this.active.values()) {
      if (anim.isComplete) continue;

      const el = this.sceneGraph.getElement(anim.elementId);
      if (!el) {
        anim.isComplete = true;
        continue;
      }

      anyActive = true;
      const rawProgress = this.computeProgress(anim, now);
      const easedProgress = this.applyEasing(rawProgress, anim.normalized);

      this.applyAnimationFrame(el, anim.normalized, easedProgress, anim.isDeleting);
      anim.progress = rawProgress;

      if (rawProgress >= 1.0) {
        anim.isComplete = true;
        this.finalizeAnimation(el, anim);
      }
    }

    if (anyActive) {
      this.renderer.markDirty();
    }
  }

  /** Force all animations to completion — call on TTS end or user skip */
  flushAll(): void {
    for (const anim of this.active.values()) {
      if (anim.isComplete) continue;
      const el = this.sceneGraph.getElement(anim.elementId);
      if (el) {
        this.applyAnimationFrame(el, anim.normalized, 1.0, anim.isDeleting);
        this.finalizeAnimation(el, anim);
      }
      anim.isComplete = true;
    }
    this.renderer.markDirty();
  }

  /** Returns true if any animation is currently running */
  hasActiveAnimations(): boolean {
    for (const anim of this.active.values()) {
      if (!anim.isComplete) return true;
    }
    return false;
  }

  clear(): void {
    this.active.clear();
  }

  // ---------------------------------------------------------------------------
  // Progress computation
  // ---------------------------------------------------------------------------

  private computeProgress(anim: ActiveAnimation, now: number): number {
    let raw: number;

    if (anim.endTime !== null) {
      // Exact end time known — use wall-clock progress
      const duration = Math.max(anim.endTime - anim.startTime, 1);
      raw = Math.min((now - anim.startTime) / duration, 1.0);
    } else {
      const type = anim.normalized.type;

      if ((type === "typewrite" || type === "draw") && anim.estimatedEndTime !== null) {
        // For reveal animations: use phrase-timing estimate without a soft-cap.
        const duration = Math.max(anim.estimatedEndTime - anim.startTime, 1);
        raw = Math.min((now - anim.startTime) / duration, 1.0);
      } else {
        // Fallback for other animations or before any word events arrive: soft-cap
        const elapsed = now - anim.startTime;
        raw = Math.min((elapsed / SOFTCAP_DURATION_MS) * SOFTCAP_PROGRESS, SOFTCAP_PROGRESS);
      }
    }

    // Guarantee monotonic increase — prevents jitter when estimatedEndTime first
    // becomes available and its initial estimate is behind the current soft-cap progress.
    return Math.max(raw, anim.progress);
  }

  // ---------------------------------------------------------------------------
  // Easing
  // ---------------------------------------------------------------------------

  private applyEasing(p: number, norm: NormalizedAnimation): number {
    // Typewrite and draw are linear so reveals track phrase timing evenly
    if (norm.type === "typewrite" || norm.type === "draw") return p;

    switch (norm.easing) {
      case "linear":       return p;
      case "ease_in":      return p * p;
      case "ease_out":     return 1 - (1 - p) * (1 - p);
      case "ease_in_out":  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      case "spring": {
        // Damped spring: overshoot at ~0.7, settle to 1.0
        if (p >= 1) return 1;
        return 1 - Math.exp(-6.5 * p) * Math.cos(2 * Math.PI * 1.5 * p);
      }
      default:             return 1 - (1 - p) * (1 - p);
    }
  }

  // ---------------------------------------------------------------------------
  // Animation frame application — mutates LiveElement properties
  // ---------------------------------------------------------------------------

  private initStartState(el: LiveElement, norm: NormalizedAnimation, isDeleting: boolean): void {
    if (isDeleting) {
      // Exit animations start from fully visible
      el.opacity = 1;
      el.scale   = 1;
      return;
    }

    switch (norm.type) {
      case "fade_enter":
        el.opacity = 0;
        el.scale   = 1;
        break;
      case "pop":
        el.opacity = 0;
        el.scale   = 0;
        break;
      case "pulse":
        el.opacity = 1;  // element is already visible
        el.scale   = 1;
        break;
      case "flash":
        el.opacity = 1;
        el.scale   = 1;
        el.flashColor = null;  // will be set during frame application
        break;
      case "draw":
        el.opacity      = 1;
        el.drawProgress = 0;
        el.scale        = 1;
        break;
      case "typewrite":
        el.opacity      = 1;
        el.visibleChars = 0;
        el.scale        = 1;
        break;
      case "morph":
        el.opacity = 1;
        el.scale   = 1;
        // morphFrom should already be set by WhiteboardPlayer before calling onAnimationStart
        break;
      case "fade_exit":
        el.opacity = 1;
        el.scale   = 1;
        break;
      case "shrink":
        el.opacity = 1;
        el.scale   = 1;
        break;
    }
  }

  private applyAnimationFrame(
    el: LiveElement,
    norm: NormalizedAnimation,
    p: number,        // eased 0→1
    isDeleting: boolean
  ): void {
    // For legacy delete path (fade_in used as delete)
    if (isDeleting && norm.type !== "fade_exit" && norm.type !== "shrink") {
      el.opacity = 1 - p;
      return;
    }

    switch (norm.type) {
      case "fade_enter":
        el.opacity = p;
        break;

      case "pop": {
        // Spring: 0 → 1.15 → 1.0
        el.opacity = Math.min(p * 3, 1);  // snap opaque quickly
        if (p < 0.7) {
          el.scale = p / 0.7;
        } else {
          // Overshoot and settle: 1.0 → 1.15 → 1.0
          const t = (p - 0.7) / 0.3;
          el.scale = 1 + 0.15 * Math.sin(t * Math.PI);
        }
        break;
      }

      case "pulse": {
        // Element is already visible; scale 1 → 1.2 → 1
        el.opacity = 1;
        el.scale   = 1 + 0.2 * Math.sin(p * Math.PI);
        break;
      }

      case "flash": {
        // Brightness ramps up to peak at 0.3, then back down
        el.opacity = 1;
        const flashIntensity = Math.sin(p * Math.PI);  // 0→1→0 over the phrase
        if (el.definition.element_type === "shape") {
          const baseHex = COLOR_MAP[el.definition.fill_color];
          el.flashColor = brightenColor(baseHex, FLASH_BRIGHTNESS * flashIntensity);
        }
        break;
      }

      case "draw":
        el.drawProgress = p;
        el.opacity      = 1;
        break;

      case "typewrite": {
        const total = "content" in el.definition ? el.definition.content.length : 0;
        el.visibleChars = Math.floor(p * total);
        el.opacity      = 1;
        break;
      }

      case "morph": {
        // Interpolate properties between morphFrom and current definition
        this.applyMorphFrame(el, p);
        break;
      }

      case "fade_exit":
        el.opacity = 1 - p;
        break;

      case "shrink":
        el.opacity = 1;
        el.scale   = 1 - p;  // scale 1→0
        break;
    }
  }

  /**
   * Morph: interpolate between el.morphFrom (old state) and el.definition (new state).
   * Only visual properties are interpolated; structural properties (id, type) are not.
   */
  private applyMorphFrame(el: LiveElement, p: number): void {
    if (!el.morphFrom) return;

    const from = el.morphFrom;
    const to = el.definition;

    // Interpolate colors
    if (from.element_type === "shape" && to.element_type === "shape") {
      if (from.fill_color !== to.fill_color) {
        const fromHex = COLOR_MAP[from.fill_color];
        const toHex   = COLOR_MAP[to.fill_color];
        el.flashColor = interpolateColor(fromHex, toHex, p);
      }
      // Size interpolation — update resolved geometry
      if (from.width_percent !== to.width_percent || from.height_percent !== to.height_percent) {
        // We interpolate the resolved pixel dimensions proportionally
        // This is an approximation — full re-resolve would be more accurate
        // but would require the PositionResolver in this module
        const wRatio = from.width_percent + (to.width_percent - from.width_percent) * p;
        const hRatio = from.height_percent + (to.height_percent - from.height_percent) * p;
        // Scale relative to the "to" resolved geometry
        if (to.width_percent > 0) {
          el.resolved.width = el.resolved.width * (wRatio / to.width_percent);
        }
        if (to.height_percent > 0) {
          el.resolved.height = el.resolved.height * (hRatio / to.height_percent);
        }
      }
    }

    // Text content: cross-fade via opacity (handled in painter via morphProgress)
    // For now, we snap text content at the midpoint
    if (from.element_type === "text" && to.element_type === "text") {
      if (from.color !== to.color) {
        const fromHex = COLOR_MAP[from.color];
        const toHex   = COLOR_MAP[to.color];
        el.flashColor = interpolateColor(fromHex, toHex, p);
      }
    }
  }

  private finalizeAnimation(el: LiveElement, anim: ActiveAnimation): void {
    if (anim.isDeleting || anim.normalized.type === "fade_exit" || anim.normalized.type === "shrink") {
      el.state   = "deleted";
      el.opacity = 0;
      this.sceneGraph.hardDelete(anim.elementId);
    } else {
      el.state   = "visible";
      el.opacity = 1;
      el.scale   = 1;
      // Clear animation-specific fields
      delete el.drawProgress;
      delete el.morphFrom;
      el.flashColor = undefined;
      if (el.visibleChars !== undefined) {
        // Keep at full content length
        if ("content" in el.definition) {
          el.visibleChars = el.definition.content.length;
        }
      }
    }
  }
}
