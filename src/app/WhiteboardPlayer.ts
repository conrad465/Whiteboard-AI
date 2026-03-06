import type {
  SceneDefinition,
  WhiteboardAction,
  CreateAction,
  EditAction,
  DeleteAction,
  AnimationConfig,
} from "../schema/types";
import { SceneGraph }           from "../engine/SceneGraph";
import { PositionResolver }     from "../engine/PositionResolver";
import { ElementPainter }       from "../engine/ElementPainter";
import { Renderer }             from "../engine/Renderer";
import { AnimationController }  from "../engine/AnimationController";
import { ActionScheduler }      from "../engine/ActionScheduler";
import { TTSEngine }            from "../tts/TTSEngine";
import { TranscriptMapper }     from "../tts/TranscriptMapper";
import { BoundaryTracker }      from "../tts/BoundaryTracker";

// -----------------------------------------------------------------------------
// PlayerState
// -----------------------------------------------------------------------------

export type PlayerState = "idle" | "playing" | "paused" | "finished";

export type PlayerStateChangeHandler = (state: PlayerState) => void;

// -----------------------------------------------------------------------------
// WhiteboardPlayer — orchestrates all modules
// -----------------------------------------------------------------------------

export class WhiteboardPlayer {
  private sceneGraph:          SceneGraph;
  private positionResolver:    PositionResolver;
  private renderer:            Renderer;
  private animationController: AnimationController;
  private actionScheduler:     ActionScheduler | null = null;
  private ttsEngine:           TTSEngine;
  private transcriptMapper:    TranscriptMapper;
  private boundaryTracker:     BoundaryTracker;

  private scene:      SceneDefinition | null = null;
  private _state:     PlayerState = "idle";
  private rafId:      number | null = null;
  private onStateChange: PlayerStateChangeHandler | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.sceneGraph       = new SceneGraph();
    const painter         = new ElementPainter();
    this.positionResolver = new PositionResolver(canvas.width, canvas.height, this.sceneGraph);
    this.renderer         = new Renderer(canvas, this.sceneGraph, painter, "white");
    this.animationController = new AnimationController(this.renderer, this.sceneGraph);
    this.ttsEngine        = new TTSEngine();
    this.transcriptMapper = new TranscriptMapper();

    this.boundaryTracker  = new BoundaryTracker(
      (actionId) => this.handleAnimationStart(actionId),
      (actionId) => this.animationController.onAnimationEnd(actionId)
    );

    // Start rAF loop — it runs forever, only redraws when dirty
    this.startRafLoop();
    this.renderer.start();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get state(): PlayerState { return this._state; }

  onStateChanged(handler: PlayerStateChangeHandler): void {
    this.onStateChange = handler;
  }

  /**
   * Load a scene definition. Resets the canvas to blank.
   */
  loadScene(scene: SceneDefinition): void {
    this.stop();
    this.scene = scene;

    // Reset engine state
    this.sceneGraph.clear();
    this.animationController.clear();
    this.boundaryTracker.reset();

    // Update canvas background
    this.renderer.setBgColor(scene.canvas.background_color);

    // Build lookup table and trigger mappings
    this.actionScheduler = new ActionScheduler(scene.actions);
    const mappings = this.transcriptMapper.buildMappings(scene.transcript, scene.actions);
    this.boundaryTracker.loadMappings(mappings);

    this.setState("idle");
    this.renderer.forceRedraw();
  }

  /**
   * Start playback from the beginning.
   */
  play(): void {
    if (!this.scene) {
      console.warn("WhiteboardPlayer.play(): no scene loaded");
      return;
    }

    // Reset if previously finished
    if (this._state === "finished") {
      this.loadScene(this.scene);
    }

    this.setState("playing");

    this.ttsEngine.speak(
      this.scene.transcript,
      (event) => this.boundaryTracker.handleBoundary(event),
      () => this.handleTTSEnd()
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
    this.animationController.flushAll();
    this.setState("idle");
  }

  /**
   * Update the canvas size (e.g., on window resize).
   * Note: this does NOT re-resolve element positions; that would require
   * replaying the scene. Positions are baked at create time.
   */
  resize(width: number, height: number): void {
    this.positionResolver.updateCanvasSize(width, height);
  }

  // ---------------------------------------------------------------------------
  // Internal: TTS end handler
  // ---------------------------------------------------------------------------

  private handleTTSEnd(): void {
    // Complete any actions that didn't get a boundary event for their end word
    this.boundaryTracker.handleEnd();
    // Force all animations to completion
    this.animationController.flushAll();
    this.setState("finished");
  }

  // ---------------------------------------------------------------------------
  // Internal: action execution (called by BoundaryTracker via onStart)
  // ---------------------------------------------------------------------------

  private handleAnimationStart(actionId: string): void {
    if (!this.scene || !this.actionScheduler) return;

    const action = this.actionScheduler.getAction(actionId);
    if (!action) {
      console.warn(`WhiteboardPlayer: no action found for id "${actionId}"`);
      return;
    }

    try {
      this.executeAction(action);
    } catch (err) {
      console.error(`WhiteboardPlayer: error executing action "${actionId}":`, err);
    }
  }

  private executeAction(action: WhiteboardAction): void {
    if (!this.scene) return;

    const animConfig: AnimationConfig = action.animation ?? this.scene.default_animation;

    switch (action.action_type) {
      case "create": {
        const create = action as CreateAction;
        const geometry = this.positionResolver.resolve(create.element);
        this.sceneGraph.addElement(create.element, geometry);
        this.animationController.onAnimationStart(
          create.action_id,
          create.element.id,
          animConfig,
          false
        );
        break;
      }

      case "edit": {
        const edit = action as EditAction;
        const el = this.sceneGraph.getElement(edit.element_id);
        if (!el) {
          console.warn(`WhiteboardPlayer: edit target "${edit.element_id}" not found in scene graph`);
          return;
        }
        // Apply changes to the element definition
        this.sceneGraph.updateElement(edit.element_id, edit.changes as Partial<typeof el.definition>);

        // Use pop_highlight as the default for edits if no animation specified
        const editAnim: AnimationConfig = action.animation ?? { type: "pop_highlight" };
        this.animationController.onAnimationStart(
          edit.action_id,
          edit.element_id,
          editAnim,
          false
        );
        break;
      }

      case "delete": {
        const del = action as DeleteAction;
        const el = this.sceneGraph.getElement(del.element_id);
        if (!el) {
          console.warn(`WhiteboardPlayer: delete target "${del.element_id}" not found in scene graph`);
          return;
        }
        const deleteAnim: AnimationConfig = action.animation ?? { type: "fade_in" };
        this.animationController.onAnimationStart(
          del.action_id,
          del.element_id,
          deleteAnim,
          true  // isDeleting = true → AnimationController fades out and removes
        );
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: rAF loop
  // ---------------------------------------------------------------------------

  private startRafLoop(): void {
    const tick = (now: number) => {
      this.animationController.tick(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private setState(state: PlayerState): void {
    this._state = state;
    this.onStateChange?.(state);
  }

  destroy(): void {
    this.ttsEngine.cancel();
    this.renderer.stop();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
