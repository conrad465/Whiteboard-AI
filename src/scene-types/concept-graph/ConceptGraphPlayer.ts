// =============================================================================
// ConceptGraphPlayer — self-contained orchestrator for Concept Graph scenes
//
// Reuses TTS infrastructure (TTSEngine, BoundaryTracker, TranscriptMapper).
// Has its own layout, painting, and animation state management.
// Supports auto-enter edges: edges appear when both endpoints are visible.
// =============================================================================

import type { ConceptGraphScene, VisualElement, NarrativeBeat } from "./types";
import { computeLayout } from "./layout";
import { ConceptGraphPainter } from "./painter";
import { TTSEngine } from "../../tts/TTSEngine";
import { TranscriptMapper } from "../../tts/TranscriptMapper";
import { BoundaryTracker } from "../../tts/BoundaryTracker";

export type PlayerState = "idle" | "playing" | "paused" | "finished";
export type PlayerStateChangeHandler = (state: PlayerState) => void;

// Animation timing
const SOFTCAP_PROGRESS = 0.8;
const SOFTCAP_DURATION_MS = 600;

function beatActionId(index: number): string {
  return `__beat_${index}__`;
}

export class ConceptGraphPlayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private painter = new ConceptGraphPainter();
  private ttsEngine = new TTSEngine();
  private transcriptMapper = new TranscriptMapper();
  private boundaryTracker: BoundaryTracker;

  private scene: ConceptGraphScene | null = null;
  private elements: VisualElement[] = [];
  private elementMap = new Map<string, VisualElement>();

  private _state: PlayerState = "idle";
  private onStateChange: PlayerStateChangeHandler | null = null;
  private rafId: number | null = null;
  private isDirty = true;
  private _isSeeking = false;

  // Track which node IDs are currently visible (for auto-enter edges)
  private visibleNodes = new Set<string>();

  // Active animations
  private activeAnimations = new Map<string, {
    elementId: string;
    animType: "fade" | "pop" | "draw" | "typewrite" | "pulse" | "flash" | "shrink";
    startTime: number;
    endTime: number | null;
    estimatedEndTime: number | null;
    progress: number;
    isComplete: boolean;
    isExit: boolean;
  }>();

  // Title animation state
  private titleStartTime: number | null = null;
  private titleDuration = 2000;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;

    this.boundaryTracker = new BoundaryTracker(
      (actionId) => this.handleBeatStart(actionId),
      (actionId) => this.handleBeatEnd(actionId),
      (actionId, charProgress) => this.handleBeatProgress(actionId, charProgress),
    );

    this.startRafLoop();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get state(): PlayerState { return this._state; }

  onStateChanged(handler: PlayerStateChangeHandler): void {
    this.onStateChange = handler;
  }

  loadScene(scene: ConceptGraphScene): void {
    this.stop();
    this.scene = scene;
    this.activeAnimations.clear();
    this.boundaryTracker.reset();
    this.titleStartTime = null;
    this.visibleNodes.clear();

    // Compute layout
    this.elements = computeLayout(scene, this.canvas.width, this.canvas.height);
    this.elementMap.clear();
    for (const el of this.elements) {
      this.elementMap.set(el.id, el);
    }

    // Build trigger mappings from narrative beats
    const syntheticActions = scene.narrative.map((beat, i) => ({
      action_id: beatActionId(i),
      action_type: "create" as const,
      trigger_phrase: beat.trigger_phrase,
      element: { id: "__dummy__", element_type: "text" as const, content: "", font_size: "medium" as const, color: "black" as const, position: { type: "canvas" as const, x_percent: 0, y_percent: 0, anchor: "center" as const } },
    }));

    const mappings = this.transcriptMapper.buildMappings(scene.transcript, syntheticActions);
    this.boundaryTracker.loadMappings(mappings);

    this.setState("idle");
    this.isDirty = true;
  }

  play(): void {
    if (!this.scene) return;

    if (this._state === "finished") {
      this.loadScene(this.scene);
    }

    this.setState("playing");
    this.startTitleAnimation();

    this.ttsEngine.speak(
      this.scene.transcript,
      (event) => this.boundaryTracker.handleBoundary(event),
      () => this.handleTTSEnd(),
    );
  }

  pause(): void {
    if (this._state !== "playing") return;
    this.ttsEngine.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this._state !== "paused") return;
    this.ttsEngine.resume();
    this.setState("playing");
  }

  stop(): void {
    this.ttsEngine.cancel();
    this.flushAllAnimations();
    this.setState("idle");
  }

  resize(width: number, height: number): void {
    if (this.scene) {
      this.elements = computeLayout(this.scene, width, height);
      this.elementMap.clear();
      for (const el of this.elements) this.elementMap.set(el.id, el);
      this.isDirty = true;
    }
  }

  destroy(): void {
    this.ttsEngine.cancel();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Title animation
  // ---------------------------------------------------------------------------

  private startTitleAnimation(): void {
    const titleEl = this.elementMap.get("__title__");
    if (!titleEl) return;

    titleEl.state = "animating";
    titleEl.visibleChars = 0;
    titleEl.opacity = 1;
    this.titleStartTime = performance.now();
    this.isDirty = true;
  }

  private tickTitle(now: number): void {
    if (this.titleStartTime === null) return;
    const titleEl = this.elementMap.get("__title__");
    if (!titleEl || titleEl.state === "visible") return;

    const elapsed = now - this.titleStartTime;
    const progress = Math.min(elapsed / this.titleDuration, 1);
    const totalChars = titleEl.label?.length ?? 0;
    titleEl.visibleChars = Math.floor(progress * totalChars);
    titleEl.opacity = 1;
    this.isDirty = true;

    if (progress >= 1) {
      titleEl.state = "visible";
      titleEl.visibleChars = totalChars;
    }
  }

  // ---------------------------------------------------------------------------
  // Narrative beat handling
  // ---------------------------------------------------------------------------

  private handleBeatStart(actionId: string): void {
    if (!this.scene) return;

    const match = actionId.match(/__beat_(\d+)__/);
    if (!match) return;
    const beatIndex = parseInt(match[1], 10);
    const beat = this.scene.narrative[beatIndex];
    if (!beat) return;

    this.executeBeat(beat, beatIndex);
  }

  private handleBeatEnd(actionId: string): void {
    // Mark all animations for this beat as having a known end time
    for (const [animId, anim] of this.activeAnimations) {
      if (animId.startsWith(actionId) && !anim.isComplete && anim.endTime === null) {
        anim.endTime = performance.now();
      }
    }
  }

  private handleBeatProgress(actionId: string, charProgress: number): void {
    for (const [animId, anim] of this.activeAnimations) {
      if (animId.startsWith(actionId) && !anim.isComplete && anim.endTime === null) {
        const now = performance.now();
        const elapsed = now - anim.startTime;
        if (charProgress > 0 && elapsed > 80) {
          anim.estimatedEndTime = anim.startTime + elapsed / charProgress;
        }
      }
    }
  }

  private executeBeat(beat: NarrativeBeat, beatIndex: number): void {
    const actionId = beatActionId(beatIndex);

    for (const targetId of beat.targets) {
      const el = this.elementMap.get(targetId);
      if (!el) continue;

      switch (beat.action) {
        case "enter":
          this.enterElement(el, actionId);
          break;
        case "emphasize":
          this.emphasizeElement(el, actionId);
          break;
        case "exit":
          this.exitElement(el, actionId);
          break;
      }
    }

    // After entering nodes, check for auto-enter edges
    if (beat.action === "enter") {
      this.autoEnterEdges(actionId);
    }
  }

  private enterElement(el: VisualElement, actionId: string): void {
    if (el.state === "visible") return;

    let animType: "fade" | "pop" | "draw" | "typewrite" = "fade";
    switch (el.type) {
      case "node":
        animType = "pop";
        el.scale = 0;
        el.opacity = 0;
        break;
      case "edge":
        animType = "draw";
        el.drawProgress = 0;
        el.opacity = 1;
        break;
      case "edge_label":
        animType = "fade";
        el.opacity = 0;
        break;
      case "title":
        animType = "typewrite";
        el.visibleChars = 0;
        el.opacity = 1;
        break;
    }

    el.state = "animating";
    this.isDirty = true;

    const animId = `${actionId}_${el.id}`;
    this.activeAnimations.set(animId, {
      elementId: el.id,
      animType,
      startTime: performance.now(),
      endTime: null,
      estimatedEndTime: null,
      progress: 0,
      isComplete: false,
      isExit: false,
    });

    // Track visible nodes
    if (el.type === "node") {
      this.visibleNodes.add(el.id);
    }
  }

  private emphasizeElement(el: VisualElement, actionId: string): void {
    if (el.state !== "visible") return;

    el.state = "animating";
    const animType = el.type === "edge" ? "flash" : "pulse";
    const animId = `${actionId}_${el.id}_emph`;
    this.activeAnimations.set(animId, {
      elementId: el.id,
      animType,
      startTime: performance.now(),
      endTime: null,
      estimatedEndTime: null,
      progress: 0,
      isComplete: false,
      isExit: false,
    });
    this.isDirty = true;
  }

  private exitElement(el: VisualElement, actionId: string): void {
    if (el.state === "hidden") return;

    el.state = "animating";
    const animType = el.type === "node" ? "shrink" : "fade";
    const animId = `${actionId}_${el.id}_exit`;
    this.activeAnimations.set(animId, {
      elementId: el.id,
      animType,
      startTime: performance.now(),
      endTime: null,
      estimatedEndTime: null,
      progress: 0,
      isComplete: false,
      isExit: true,
    });
    this.isDirty = true;

    if (el.type === "node") {
      this.visibleNodes.delete(el.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-enter edges
  // ---------------------------------------------------------------------------

  /** Automatically enter edges whose both endpoints are now visible */
  private autoEnterEdges(actionId: string): void {
    for (const el of this.elements) {
      if (el.type !== "edge") continue;
      if (el.state !== "hidden") continue;
      if (!el.fromNodeId || !el.toNodeId) continue;

      if (this.visibleNodes.has(el.fromNodeId) && this.visibleNodes.has(el.toNodeId)) {
        this.enterElement(el, actionId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Animation tick
  // ---------------------------------------------------------------------------

  private tickAnimations(now: number): void {
    let anyActive = false;

    for (const anim of this.activeAnimations.values()) {
      if (anim.isComplete) continue;

      const el = this.elementMap.get(anim.elementId);
      if (!el) { anim.isComplete = true; continue; }

      anyActive = true;
      const rawProgress = this.computeProgress(anim, now);

      // Apply easing
      let p: number;
      if (anim.animType === "draw" || anim.animType === "typewrite") {
        p = rawProgress; // linear
      } else if (anim.animType === "pop" || anim.animType === "pulse") {
        // Spring easing
        p = rawProgress >= 1 ? 1 : 1 - Math.exp(-6.5 * rawProgress) * Math.cos(2 * Math.PI * 1.5 * rawProgress);
      } else {
        // ease-out for fade enter, ease-in for fade exit
        if (anim.isExit) {
          p = rawProgress * rawProgress; // ease-in
        } else {
          p = 1 - (1 - rawProgress) * (1 - rawProgress); // ease-out
        }
      }

      this.applyAnimFrame(el, anim.animType, p, anim.isExit);
      anim.progress = rawProgress;

      if (rawProgress >= 1) {
        anim.isComplete = true;
        this.finalizeAnim(el, anim.animType, anim.isExit);
      }
    }

    if (anyActive) this.isDirty = true;
  }

  private computeProgress(
    anim: { startTime: number; endTime: number | null; estimatedEndTime: number | null; progress: number; animType: string },
    now: number,
  ): number {
    let raw: number;

    if (anim.endTime !== null) {
      const duration = Math.max(anim.endTime - anim.startTime, 1);
      raw = Math.min((now - anim.startTime) / duration, 1.0);
    } else if ((anim.animType === "typewrite" || anim.animType === "draw") && anim.estimatedEndTime !== null) {
      const duration = Math.max(anim.estimatedEndTime - anim.startTime, 1);
      raw = Math.min((now - anim.startTime) / duration, 1.0);
    } else {
      const elapsed = now - anim.startTime;
      raw = Math.min((elapsed / SOFTCAP_DURATION_MS) * SOFTCAP_PROGRESS, SOFTCAP_PROGRESS);
    }

    return Math.max(raw, anim.progress);
  }

  private applyAnimFrame(el: VisualElement, animType: string, p: number, isExit: boolean): void {
    if (isExit) {
      if (animType === "shrink") {
        el.scale = 1 - p;
        el.opacity = 1 - p;
      } else {
        // fade exit
        el.opacity = 1 - p;
      }
      return;
    }

    switch (animType) {
      case "fade":
        el.opacity = p;
        break;
      case "pop":
        el.opacity = Math.min(p * 3, 1);
        if (p < 0.7) {
          el.scale = p / 0.7;
        } else {
          const t = (p - 0.7) / 0.3;
          el.scale = 1 + 0.15 * Math.sin(t * Math.PI);
        }
        break;
      case "draw":
        el.drawProgress = p;
        el.opacity = 1;
        break;
      case "typewrite": {
        const total = el.label?.length ?? 0;
        el.visibleChars = Math.floor(p * total);
        el.opacity = 1;
        break;
      }
      case "pulse":
        el.opacity = 1;
        el.scale = 1 + 0.2 * Math.sin(p * Math.PI);
        break;
      case "flash":
        el.opacity = 1;
        break;
    }
  }

  private finalizeAnim(el: VisualElement, animType: string, isExit: boolean): void {
    if (isExit) {
      el.state = "hidden";
      el.opacity = 0;
      el.scale = animType === "shrink" ? 0 : 1;
    } else {
      el.state = "visible";
      el.opacity = 1;
      el.scale = 1;
      if (animType === "draw") el.drawProgress = 1;
      if (animType === "typewrite") el.visibleChars = el.label?.length ?? 0;
    }
  }

  private flushAllAnimations(): void {
    for (const anim of this.activeAnimations.values()) {
      if (anim.isComplete) continue;
      const el = this.elementMap.get(anim.elementId);
      if (el) {
        this.applyAnimFrame(el, anim.animType, 1, anim.isExit);
        this.finalizeAnim(el, anim.animType, anim.isExit);
      }
      anim.isComplete = true;
    }
    this.isDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  private startRafLoop(): void {
    const tick = (now: number) => {
      this.tickTitle(now);
      this.tickAnimations(now);

      if (this.isDirty) {
        this.render();
        this.isDirty = false;
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private render(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);

    // Paint edges first (below nodes), then nodes, then title on top
    for (const el of this.elements) {
      if (el.state !== "hidden" && el.type === "edge") {
        this.painter.paint(ctx, el);
      }
    }
    for (const el of this.elements) {
      if (el.state !== "hidden" && el.type === "node") {
        this.painter.paint(ctx, el);
      }
    }
    for (const el of this.elements) {
      if (el.state !== "hidden" && (el.type === "title" || el.type === "edge_label")) {
        this.painter.paint(ctx, el);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // TTS end handler
  // ---------------------------------------------------------------------------

  private handleTTSEnd(): void {
    if (this._isSeeking) return;
    this.boundaryTracker.handleEnd();
    this.flushAllAnimations();
    this.setState("finished");
  }

  private setState(state: PlayerState): void {
    this._state = state;
    this.onStateChange?.(state);
  }
}
