// =============================================================================
// Concept Graph Painter — draws VisualElements onto a Canvas 2D context
// =============================================================================

import type { VisualElement } from "./types";
import { WHITEBOARD_FONT_FAMILY } from "../../schema/colors";

type Point = { x: number; y: number };

export class ConceptGraphPainter {
  paint(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (el.state === "hidden") return;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity));

    // Apply scale transform centered on element
    if (el.scale !== 1) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.scale(el.scale, el.scale);
      ctx.translate(-cx, -cy);
    }

    switch (el.type) {
      case "title":      this.paintTitle(ctx, el); break;
      case "node":       this.paintNode(ctx, el); break;
      case "edge":       this.paintEdge(ctx, el); break;
      case "edge_label": this.paintEdgeLabel(ctx, el); break;
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private paintTitle(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.label) return;
    const text = el.visibleChars !== undefined
      ? el.label.slice(0, el.visibleChars)
      : el.label;
    if (!text) return;

    ctx.font = `bold 36px ${WHITEBOARD_FONT_FAMILY}`;
    ctx.fillStyle = el.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, el.x + el.width / 2, el.y + el.height / 2);
  }

  // ---------------------------------------------------------------------------
  // Node (rounded rectangle with label)
  // ---------------------------------------------------------------------------

  private paintNode(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    const r = 6; // corner radius per spec

    // Fill
    ctx.fillStyle = el.color;
    ctx.beginPath();
    this.roundRect(ctx, el.x, el.y, el.width, el.height, r);
    ctx.fill();

    // Border (2px per spec)
    ctx.strokeStyle = el.borderColor ?? el.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label — centered inside
    if (el.label) {
      ctx.fillStyle = el.textColor ?? "#FFFFFF";
      // Scale font with node size
      const fontSize = Math.max(12, Math.min(20, el.height * 0.35));
      ctx.font = `bold ${fontSize}px ${WHITEBOARD_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.label, el.x + el.width / 2, el.y + el.height / 2, el.width - 12);
    }
  }

  // ---------------------------------------------------------------------------
  // Edge (arrow — straight or curved)
  // ---------------------------------------------------------------------------

  private paintEdge(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.edgeStart || !el.edgeEnd) return;

    const progress = el.drawProgress ?? 1;
    ctx.strokeStyle = el.color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    if (el.isCurved && el.edgeControl) {
      this.paintCurvedEdge(ctx, el.edgeStart, el.edgeEnd, el.edgeControl, progress, el.color);
    } else {
      this.paintStraightEdge(ctx, el.edgeStart, el.edgeEnd, progress, el.color);
    }

    // Edge label at midpoint (once edge is >50% drawn)
    if (el.label && progress >= 0.5) {
      const mid = el.isCurved && el.edgeControl
        ? quadBezierPoint(el.edgeStart, el.edgeControl, el.edgeEnd, 0.5)
        : { x: (el.edgeStart.x + el.edgeEnd.x) / 2, y: (el.edgeStart.y + el.edgeEnd.y) / 2 };

      // White background pad for readability
      const fontSize = 12;
      ctx.font = `${fontSize}px ${WHITEBOARD_FONT_FAMILY}`;
      const textWidth = ctx.measureText(el.label).width;
      const padX = 4, padY = 2;

      ctx.fillStyle = "#FFFFFF";
      ctx.globalAlpha = (ctx.globalAlpha > 0 ? ctx.globalAlpha : 1) * 0.85;
      ctx.fillRect(
        mid.x - textWidth / 2 - padX,
        mid.y - fontSize / 2 - padY,
        textWidth + padX * 2,
        fontSize + padY * 2,
      );

      ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity));
      ctx.fillStyle = el.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.label, mid.x, mid.y);
    }
  }

  private paintStraightEdge(
    ctx: CanvasRenderingContext2D,
    start: Point, end: Point,
    progress: number, color: string,
  ): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const currentX = start.x + dx * progress;
    const currentY = start.y + dy * progress;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    // Arrowhead (8px filled triangle per spec)
    if (progress >= 0.95) {
      const angle = Math.atan2(dy, dx);
      this.paintArrowhead(ctx, end.x, end.y, angle, 8, color);
    }
  }

  private paintCurvedEdge(
    ctx: CanvasRenderingContext2D,
    start: Point, end: Point, control: Point,
    progress: number, color: string,
  ): void {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);

    if (progress >= 1) {
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    } else {
      const pt = quadBezierPoint(start, control, end, progress);
      const cp = quadBezierSubdivideControl(start, control, progress);
      ctx.quadraticCurveTo(cp.x, cp.y, pt.x, pt.y);
    }
    ctx.stroke();

    // Arrowhead
    if (progress >= 0.95) {
      const angle = Math.atan2(end.y - control.y, end.x - control.x);
      this.paintArrowhead(ctx, end.x, end.y, angle, 8, color);
    }
  }

  private paintArrowhead(
    ctx: CanvasRenderingContext2D,
    tipX: number, tipY: number,
    angle: number, size: number, color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - size * Math.cos(angle - Math.PI / 6),
      tipY - size * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      tipX - size * Math.cos(angle + Math.PI / 6),
      tipY - size * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // Edge label (standalone — used if separated from edge element)
  // ---------------------------------------------------------------------------

  private paintEdgeLabel(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.label) return;
    ctx.fillStyle = el.color;
    ctx.font = `12px ${WHITEBOARD_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(el.label, el.x + el.width / 2, el.y + el.height / 2);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
  ): void {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }
}

// =============================================================================
// Bezier helpers
// =============================================================================

function quadBezierPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function quadBezierSubdivideControl(p0: Point, p1: Point, t: number): Point {
  return {
    x: p0.x + t * (p1.x - p0.x),
    y: p0.y + t * (p1.y - p0.y),
  };
}
