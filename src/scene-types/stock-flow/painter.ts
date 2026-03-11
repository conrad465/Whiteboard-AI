// =============================================================================
// Stock & Flow Painter — draws VisualElements onto a Canvas 2D context
// =============================================================================

import type { VisualElement } from "./types";
import { WHITEBOARD_FONT_FAMILY } from "../../schema/colors";

export class StockFlowPainter {
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
      case "title":     this.paintTitle(ctx, el); break;
      case "stock":     this.paintStock(ctx, el); break;
      case "flow":      this.paintFlow(ctx, el); break;
      case "cloud":     this.paintCloud(ctx, el); break;
      case "converter": this.paintConverter(ctx, el); break;
      case "connector": this.paintConnector(ctx, el); break;
      case "flow_label": this.paintFlowLabel(ctx, el); break;
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
  // Stock (rectangle with rounded corners, label inside)
  // ---------------------------------------------------------------------------

  private paintStock(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    const r = 4; // corner radius

    // Fill
    ctx.fillStyle = el.color;
    ctx.beginPath();
    this.roundRect(ctx, el.x, el.y, el.width, el.height, r);
    ctx.fill();

    // Border
    ctx.strokeStyle = el.borderColor ?? el.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Label
    if (el.label) {
      ctx.fillStyle = el.textColor ?? "#FFFFFF";
      ctx.font = `bold 20px ${WHITEBOARD_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.label, el.x + el.width / 2, el.y + el.height / 2, el.width - 16);
    }
  }

  // ---------------------------------------------------------------------------
  // Flow (pipe with valve)
  // ---------------------------------------------------------------------------

  private paintFlow(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.pipeStart || !el.pipeEnd || !el.valveMid) return;

    const thickness = el.pipeThickness ?? 10;
    const halfT = thickness / 2;
    const progress = el.drawProgress ?? 1;
    const color = el.flowColor ?? el.color;

    // Compute how far along the pipe to draw
    const dx = el.pipeEnd.x - el.pipeStart.x;
    const dy = el.pipeEnd.y - el.pipeStart.y;
    const endX = el.pipeStart.x + dx * progress;
    const endY = el.pipeStart.y + dy * progress;

    // Pipe walls (two parallel lines)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    // Top wall
    ctx.beginPath();
    ctx.moveTo(el.pipeStart.x, el.pipeStart.y - halfT);
    ctx.lineTo(endX, endY - halfT);
    ctx.stroke();

    // Bottom wall
    ctx.beginPath();
    ctx.moveTo(el.pipeStart.x, el.pipeStart.y + halfT);
    ctx.lineTo(endX, endY + halfT);
    ctx.stroke();

    // Fill between walls (subtle)
    ctx.fillStyle = color + "1A"; // ~10% opacity
    ctx.beginPath();
    ctx.rect(
      Math.min(el.pipeStart.x, endX),
      Math.min(el.pipeStart.y, endY) - halfT,
      Math.abs(endX - el.pipeStart.x),
      thickness,
    );
    ctx.fill();

    // Valve (bowtie ⋈) — only draw if progress has reached the midpoint
    const valveProgress = (el.valveMid.x - el.pipeStart.x) / (dx || 1);
    if (progress >= valveProgress) {
      this.paintValve(ctx, el.valveMid.x, el.valveMid.y, halfT * 1.6, color);
    }

    // Arrowhead at pipe end (only when fully drawn)
    if (progress >= 0.95) {
      this.paintArrowhead(ctx, endX, endY, Math.atan2(dy, dx), halfT * 0.8, color);
    }
  }

  private paintValve(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
    // Bowtie: two triangles meeting at center
    ctx.fillStyle = color;
    ctx.beginPath();
    // Left triangle
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - size, cy + size);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    // Right triangle
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + size, cy + size);
    ctx.closePath();
    ctx.fill();
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
      tipX - size * 2 * Math.cos(angle - Math.PI / 6),
      tipY - size * 2 * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      tipX - size * 2 * Math.cos(angle + Math.PI / 6),
      tipY - size * 2 * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // Cloud (overlapping circles)
  // ---------------------------------------------------------------------------

  private paintCloud(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.cloudCircles) return;

    // Fill
    ctx.fillStyle = el.color;
    for (const c of el.cloudCircles) {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Border
    if (el.borderColor) {
      ctx.strokeStyle = el.borderColor;
      ctx.lineWidth = 1.5;
      for (const c of el.cloudCircles) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Converter (circle with label)
  // ---------------------------------------------------------------------------

  private paintConverter(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const r = Math.min(el.width, el.height) / 2;

    // Fill (30% opacity)
    ctx.fillStyle = el.color + "4D";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = el.borderColor ?? el.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    if (el.label) {
      ctx.fillStyle = el.textColor ?? el.color;
      ctx.font = `14px ${WHITEBOARD_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.label, cx, cy, el.width - 8);
    }
  }

  // ---------------------------------------------------------------------------
  // Connector (Bezier curve with arrowhead)
  // ---------------------------------------------------------------------------

  private paintConnector(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.curveStart || !el.curveEnd || !el.curveControl) return;

    const progress = el.drawProgress ?? 1;
    ctx.strokeStyle = el.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);

    // Draw partial Bezier using subdivide-at-t
    ctx.beginPath();
    ctx.moveTo(el.curveStart.x, el.curveStart.y);

    if (progress >= 1) {
      ctx.quadraticCurveTo(
        el.curveControl.x, el.curveControl.y,
        el.curveEnd.x, el.curveEnd.y,
      );
    } else {
      // Partial curve: compute point at t=progress
      const pt = quadBezierPoint(
        el.curveStart, el.curveControl, el.curveEnd, progress,
      );
      const cp = quadBezierSubdivideControl(
        el.curveStart, el.curveControl, progress,
      );
      ctx.quadraticCurveTo(cp.x, cp.y, pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead (only when fully drawn)
    if (progress >= 0.95 && el.arrowAngle !== undefined) {
      this.paintArrowhead(ctx, el.curveEnd.x, el.curveEnd.y, el.arrowAngle, 5, el.color);
    }

    // Label at midpoint
    if (el.label && progress >= 0.5) {
      const mid = quadBezierPoint(el.curveStart, el.curveControl, el.curveEnd, 0.5);
      ctx.fillStyle = el.color;
      ctx.font = `italic 12px ${WHITEBOARD_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(el.label, mid.x, mid.y - 4);
    }
  }

  // ---------------------------------------------------------------------------
  // Flow label
  // ---------------------------------------------------------------------------

  private paintFlowLabel(ctx: CanvasRenderingContext2D, el: VisualElement): void {
    if (!el.label) return;
    ctx.fillStyle = el.textColor ?? el.color;
    ctx.font = `14px ${WHITEBOARD_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(el.label, el.x + el.width / 2, el.y);
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

type Point = { x: number; y: number };

function quadBezierPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/** Control point for the first subdivision of a quadratic Bezier at parameter t. */
function quadBezierSubdivideControl(p0: Point, p1: Point, t: number): Point {
  return {
    x: p0.x + t * (p1.x - p0.x),
    y: p0.y + t * (p1.y - p0.y),
  };
}
