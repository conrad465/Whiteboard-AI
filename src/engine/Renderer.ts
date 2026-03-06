import type { NamedColor } from "../schema/types";
import type { SceneGraph } from "./SceneGraph";
import type { ElementPainter } from "./ElementPainter";
import { COLOR_MAP } from "../schema/colors";

// -----------------------------------------------------------------------------
// Renderer — dirty-flag canvas draw loop
// Only redraws when markDirty() is called (e.g. by AnimationController).
// When nothing is animating the canvas is not touched, saving CPU/GPU.
// -----------------------------------------------------------------------------

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private isDirty = false;
  private rafId: number | null = null;
  private canvas: HTMLCanvasElement;
  private sceneGraph: SceneGraph;
  private painter: ElementPainter;
  private bgColor: NamedColor;

  constructor(canvas: HTMLCanvasElement, sceneGraph: SceneGraph, painter: ElementPainter, bgColor: NamedColor) {
    this.canvas     = canvas;
    this.sceneGraph = sceneGraph;
    this.painter    = painter;
    this.bgColor    = bgColor;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Renderer: could not get 2D context from canvas");
    this.ctx = ctx;
  }

  setBgColor(color: NamedColor): void {
    this.bgColor = color;
    this.markDirty();
  }

  markDirty(): void {
    this.isDirty = true;
  }

  /** Force an immediate redraw regardless of dirty flag */
  forceRedraw(): void {
    this.isDirty = true;
    this.draw();
  }

  start(): void {
    if (this.rafId !== null) return; // already running

    const loop = () => {
      if (this.isDirty) {
        this.draw();
        this.isDirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private draw(): void {
    const { width, height } = this.canvas;

    // Clear
    this.ctx.clearRect(0, 0, width, height);

    // Background
    this.ctx.fillStyle = COLOR_MAP[this.bgColor];
    this.ctx.fillRect(0, 0, width, height);

    // Paint all non-deleted elements in z-order (insertion order)
    for (const el of this.sceneGraph.getAllVisible()) {
      this.painter.paint(this.ctx, el);
    }
  }

  /** Resize the canvas to fit its CSS display size (call on window resize) */
  fitToContainer(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const { width, height } = parent.getBoundingClientRect();
    this.canvas.width  = width;
    this.canvas.height = height;
    this.markDirty();
  }
}
