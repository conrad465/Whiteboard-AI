import type { ShapeElement, TextElement } from "../schema/types";
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

    // draw_in: clip from left to right (or top to bottom)
    if (el.drawProgress !== undefined && el.drawProgress < 1) {
      const progress = el.drawProgress;
      ctx.save();
      if (def.shape === "line" || def.shape === "arrow") {
        // For lines/arrows clip along the line direction
        ctx.beginPath();
        ctx.rect(x, y - 2, w * progress, h + 4);
      } else {
        ctx.beginPath();
        ctx.rect(x, y, w * progress, h);
      }
      ctx.clip();
    }

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

    if (el.drawProgress !== undefined && el.drawProgress < 1) {
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

    ctx.font          = `${fontStyle} ${fontSize}px ${WHITEBOARD_FONT_FAMILY}`;
    ctx.fillStyle     = COLOR_MAP[def.color];
    ctx.textBaseline  = "top";
    ctx.textAlign     = "left";

    // Apply typewriter: slice content to visibleChars
    const content = el.visibleChars !== undefined
      ? def.content.slice(0, el.visibleChars)
      : def.content;

    if (!content) return;

    const lineHeight = fontSize * 1.35;
    const lines = this.wordWrap(ctx, content, maxW);

    lines.forEach((line, i) => {
      const lineY = y + i * lineHeight;
      ctx.fillText(line, x, lineY);

      if (def.underline) {
        const lineWidth = ctx.measureText(line).width;
        ctx.save();
        ctx.strokeStyle = COLOR_MAP[def.color];
        ctx.lineWidth   = Math.max(1, fontSize / 14);
        ctx.beginPath();
        ctx.moveTo(x, lineY + fontSize + 2);
        ctx.lineTo(x + lineWidth, lineY + fontSize + 2);
        ctx.stroke();
        ctx.restore();
      }
    });
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
