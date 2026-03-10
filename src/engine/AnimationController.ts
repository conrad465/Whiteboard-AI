import type { AnimationConfig } from "../schema/types";
import type { LiveElement, SceneGraph } from "./SceneGraph";
import type { Renderer } from "./Renderer";

// -----------------------------------------------------------------------------
// ActiveAnimation — per-action animation state
// -----------------------------------------------------------------------------

interface ActiveAnimation {
  actionId: string;
  elementId: string;
  config: AnimationConfig;
  /** performance.now() when the animation started (trigger phrase first word) */
  startTime: number;
  /**
   * performance.now() when the animation should complete (trigger phrase last word).
   * null means we haven't heard the end word yet.
   */
  endTime: number | null;
  /**
   * Dynamically updated estimate of endTime, derived from mid-phrase word events.
   * Used by typewriter and draw_in to avoid the hard soft-cap cliff.
   */
  estimatedEndTime: number | null;
  progress: number;   // 0→1
  isComplete: boolean;
  /** For delete actions: fade OUT instead of in */
  isDeleting: boolean;
}

// Soft-cap: how far (0–1) to animate when end time hasn't fired yet,
// and how fast to get there (ms). This prevents elements appearing to "pause"
// mid-phrase because TTS boundary events are sparse.
const SOFTCAP_PROGRESS = 0.8;
const SOFTCAP_DURATION_MS = 600;

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
    this.active.set(actionId, {
      actionId,
      elementId,
      config,
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
    if (!isDeleting) {
      this.initStartState(el, config);
    }
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
   * Updates estimatedEndTime so typewriter/draw_in can track speech
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
      const easedProgress = this.applyEasing(rawProgress, anim.config);

      this.applyAnimationFrame(el, anim.config, easedProgress, anim.isDeleting);
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
        this.applyAnimationFrame(el, anim.config, 1.0, anim.isDeleting);
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
      const type = anim.config.type;

      if ((type === "typewriter" || type === "draw_in") && anim.estimatedEndTime !== null) {
        // For reveal animations: use phrase-timing estimate without a soft-cap.
        // This tracks speech and lets the animation complete as the last word is spoken.
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

  private applyEasing(p: number, config: AnimationConfig): number {
    // typewriter and draw_in are linear so reveals track phrase timing evenly
    if (config.type === "typewriter" || config.type === "draw_in") return p;

    const easing = config.type === "fade_in" ? (config.easing ?? "ease_out") : "ease_out";
    switch (easing) {
      case "linear":       return p;
      case "ease_in":      return p * p;
      case "ease_out":     return 1 - (1 - p) * (1 - p);
      case "ease_in_out":  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      default:             return 1 - (1 - p) * (1 - p);
    }
  }

  // ---------------------------------------------------------------------------
  // Animation frame application — mutates LiveElement properties
  // ---------------------------------------------------------------------------

  private initStartState(el: LiveElement, config: AnimationConfig): void {
    switch (config.type) {
      case "fade_in":
        el.opacity = 0;
        el.scale   = 1;
        break;
      case "pop_in":
        el.opacity = 0;
        el.scale   = 0;
        break;
      case "pop_highlight":
        el.opacity = 1;  // element is already visible
        el.scale   = 1;
        break;
      case "draw_in":
        el.opacity      = 1;
        el.drawProgress = 0;
        el.scale        = 1;
        break;
      case "typewriter":
        el.opacity      = 1;
        el.visibleChars = 0;
        el.scale        = 1;
        break;
    }
  }

  private applyAnimationFrame(
    el: LiveElement,
    config: AnimationConfig,
    p: number,        // eased 0→1
    isDeleting: boolean
  ): void {
    // For delete: reverse fade
    if (isDeleting) {
      el.opacity = 1 - p;
      return;
    }

    switch (config.type) {
      case "fade_in":
        el.opacity = p;
        break;

      case "pop_in": {
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

      case "pop_highlight": {
        // Element is already visible; scale 1 → 1.2 → 1
        el.opacity = 1;
        el.scale   = 1 + 0.2 * Math.sin(p * Math.PI);
        break;
      }

      case "draw_in":
        el.drawProgress = p;
        el.opacity      = 1;
        break;

      case "typewriter": {
        const total = "content" in el.definition ? el.definition.content.length : 0;
        el.visibleChars = Math.floor(p * total);
        el.opacity      = 1;
        break;
      }
    }
  }

  private finalizeAnimation(el: LiveElement, anim: ActiveAnimation): void {
    if (anim.isDeleting) {
      el.state   = "deleted";
      el.opacity = 0;
      this.sceneGraph.hardDelete(anim.elementId);
    } else {
      el.state   = "visible";
      el.opacity = 1;
      el.scale   = 1;
      // Clear animation-specific fields
      delete el.drawProgress;
      if (el.visibleChars !== undefined) {
        // Keep at full content length
        if ("content" in el.definition) {
          el.visibleChars = el.definition.content.length;
        }
      }
    }
  }
}
