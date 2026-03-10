import type { ShapeElement, TextElement, ShapeTextPosition } from "../schema/types";
import type { LiveElement } from "./SceneGraph";
import { COLOR_MAP, FONT_SIZE_MAP, WHITEBOARD_FONT_FAMILY } from "../schema/colors";

// -----------------------------------------------------------------------------
// ElementPainter — draws a single LiveElement onto a Canvas 2D context
// -----------------------------------------------------------------------------

export class ElementPainter {
  paint(ctx: CanvasRenderingContext2D, el: LiveElement): void {
    if (el.state === "hidden" || el.state === "deleted") return;

    const { x, y, width: w, height: h, rotation } = el.resolved;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity));

    // Apply scale transform (used by pop_in / pop_highlight) centered on element
    if (el.scale !== 1) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.scale(el.scale, el.scale);
      ctx.translate(-cx, -cy);
    }

    // Apply rotation transform centered on element
    if (rotation !== 0) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (el.definition.element_type === "shape") {
      this.paintShape(ctx, el.definition, el, x, y, w, h);
    } else {
      this.paintText(ctx, el.definition, el, x, y, w);
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Shape painting
  // ---------------------------------------------------------------------------

  private paintShape(
    ctx: CanvasRenderingContext2D,
    def: ShapeElement,
    el: LiveElement,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.fillStyle   = COLOR_MAP[def.fill_color];
    ctx.strokeStyle = COLOR_MAP[def.border_color];
    ctx.lineWidth   = def.border_width ?? 2;
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";

    const p = el.drawProgress;
    const isAnimating = p !== undefined && p < 1;

    if (isAnimating && (def.shape === "line" || def.shape === "arrow")) {
      // Lines and arrows have no fill — clip-reveal left-to-right
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y - 2, w * p!, h + 4);
      ctx.clip();
      this.drawShapeGeometry(ctx, def, x, y, w, h);
      ctx.restore();
    } else if (isAnimating) {
      // Filled shapes: phase 1 draws the perimeter, phase 2 fades in the fill
      this.paintShapeDrawIn(ctx, def, p!, x, y, w, h);
    } else {
      this.drawShapeGeometry(ctx, def, x, y, w, h);
    }

    if (def.text) {
      this.paintShapeText(ctx, def, x, y, w, h);
    }
  }

  /** Full static draw of a shape (fill + stroke). */
  private drawShapeGeometry(
    ctx: CanvasRenderingContext2D,
    def: ShapeElement,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.beginPath();
    switch (def.shape) {
      case "rectangle":
        ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.stroke();
        break;
      case "circle":
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case "triangle":
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w,     y + h);
        ctx.lineTo(x,         y + h);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case "line":
        ctx.moveTo(x,     y + h / 2);
        ctx.lineTo(x + w, y + h / 2);
        ctx.stroke();
        break;
      case "arrow":
        this.paintArrow(ctx, x, y, w, h);
        break;
    }
  }

  /**
   * Two-phase draw_in for filled shapes:
   *   0 → PERIM_END  : perimeter strokes in progressively (dash trick)
   *   PERIM_END → 1  : interior fill fades in
   */
  private paintShapeDrawIn(
    ctx: CanvasRenderingContext2D,
    def: ShapeElement,
    p: number,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const PERIM_END = 0.7;
    const perimP = Math.min(p / PERIM_END, 1.0);
    const fillP  = Math.max((p - PERIM_END) / (1 - PERIM_END), 0);

    // --- Phase 1: draw perimeter ---
    switch (def.shape) {
      case "rectangle": {
        const perim = 2 * (w + h);
        ctx.setLineDash([perim * perimP, perim]);
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "circle": {
        // Arc from top (−π/2) clockwise
        ctx.beginPath();
        ctx.ellipse(
          x + w / 2, y + h / 2, w / 2, h / 2,
          0,
          -Math.PI / 2,
          -Math.PI / 2 + perimP * Math.PI * 2
        );
        ctx.stroke();
        break;
      }
      case "triangle": {
        const leg  = Math.hypot(w / 2, h);
        const perim = 2 * leg + w;
        ctx.setLineDash([perim * perimP, perim]);
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w,     y + h);
        ctx.lineTo(x,         y + h);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
    }

    // --- Phase 2: fill fades in ---
    if (fillP > 0) {
      ctx.save();
      ctx.globalAlpha *= fillP;
      ctx.beginPath();
      switch (def.shape) {
        case "rectangle":
          ctx.rect(x, y, w, h);
          break;
        case "circle":
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          break;
        case "triangle":
          ctx.moveTo(x + w / 2, y);
          ctx.lineTo(x + w,     y + h);
          ctx.lineTo(x,         y + h);
          ctx.closePath();
          break;
      }
      ctx.fill();
      ctx.restore();
    }
  }

  private paintArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const headW = Math.min(w * 0.3,  24);
    const headH = Math.min(h * 0.8,  h);
    const midY  = y + h / 2;
    const shaftEnd = x + w - headW;

    // Shaft
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(shaftEnd, midY);
    ctx.stroke();

    // Arrowhead (filled triangle)
    ctx.beginPath();
    ctx.moveTo(x + w,     midY);
    ctx.lineTo(shaftEnd,  midY - headH / 2);
    ctx.lineTo(shaftEnd,  midY + headH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Text painting
  // ---------------------------------------------------------------------------

  private paintText(
    ctx: CanvasRenderingContext2D,
    def: TextElement,
    el: LiveElement,
    x: number,
    y: number,
    maxW: number
  ): void {
    const fontSize = FONT_SIZE_MAP[def.font_size];
    const fontStyle = [
      def.italic ? "italic" : "",
      def.bold   ? "bold"   : "normal",
    ].filter(Boolean).join(" ");

    const align = def.text_align ?? "left";
    const drawX = align === "center" ? x + maxW / 2
                : align === "right"  ? x + maxW
                : x;

    ctx.font         = `${fontStyle} ${fontSize}px ${WHITEBOARD_FONT_FAMILY}`;
    ctx.fillStyle    = COLOR_MAP[def.color];
    ctx.textBaseline = "top";
    ctx.textAlign    = align;

    // Apply typewriter: slice content to visibleChars
    const content = el.visibleChars !== undefined
      ? def.content.slice(0, el.visibleChars)
      : def.content;

    if (!content) return;

    const lineHeight = fontSize * 1.35;
    const lines = this.wordWrap(ctx, content, maxW);

    lines.forEach((line, i) => {
      const lineY = y + i * lineHeight;
      ctx.fillText(line, drawX, lineY);

      if (def.underline) {
        const lw = ctx.measureText(line).width;
        const ulX = align === "center" ? drawX - lw / 2
                  : align === "right"  ? drawX - lw
                  : drawX;
        ctx.save();
        ctx.strokeStyle = COLOR_MAP[def.color];
        ctx.lineWidth   = Math.max(1, fontSize / 14);
        ctx.beginPath();
        ctx.moveTo(ulX, lineY + fontSize + 2);
        ctx.lineTo(ulX + lw, lineY + fontSize + 2);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  private paintShapeText(
    ctx: CanvasRenderingContext2D,
    def: ShapeElement,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const fontSize = FONT_SIZE_MAP[def.font_size ?? "medium"];
    ctx.font         = `${fontSize}px ${WHITEBOARD_FONT_FAMILY}`;
    ctx.fillStyle    = COLOR_MAP[def.text_color ?? "black"];
    ctx.textBaseline = "top";

    const padding  = Math.min(w, h) * 0.1;
    const availW   = w - padding * 2;
    const align    = def.text_align ?? "center";
    const position = def.text_position ?? "middle_center";

    ctx.textAlign = align;

    const lines      = this.wordWrap(ctx, def.text!, availW);
    const lineHeight = fontSize * 1.35;
    const totalH     = lines.length * lineHeight;

    // Horizontal draw anchor
    const drawX = align === "left"   ? x + padding
                : align === "right"  ? x + w - padding
                : x + w / 2;

    // Vertical starting position from 3×3 grid
    const row = (position as ShapeTextPosition).split("_")[0]; // "top" | "middle" | "bottom"
    const drawY = row === "top"    ? y + padding
                : row === "bottom" ? y + h - totalH - padding
                : y + h / 2 - totalH / 2;

    // Clip to shape bounds so text never overflows
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    lines.forEach((line, i) => {
      ctx.fillText(line, drawX, drawY + i * lineHeight);
    });

    ctx.restore();
  }

  private wordWrap(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}
