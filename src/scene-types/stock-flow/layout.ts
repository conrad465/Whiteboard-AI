// =============================================================================
// Stock & Flow Layout Engine
//
// Takes a StockFlowScene and canvas dimensions, produces positioned
// VisualElements ready for rendering. The LLM provides zero layout info.
// =============================================================================

import type {
  StockFlowScene, VisualElement, Stock, Flow,
} from "./types";
import { DEFAULT_COLORS } from "./types";
import { COLOR_MAP, brightenColor } from "../../schema/colors";
import type { NamedColor } from "../../schema/types";

// Layout constants (as fractions of canvas dimensions)
const TITLE_BAND = 0.10;       // top 10% reserved for title
const STOCK_W_FRAC = 0.16;     // stock width as fraction of canvas width
const STOCK_H_FRAC = 0.13;     // stock height as fraction of canvas height
const CLOUD_W_FRAC = 0.055;    // cloud width
const CLOUD_H_FRAC = 0.06;     // cloud height
const CONVERTER_D_FRAC = 0.07; // converter diameter as fraction of canvas width
const PIPE_THICKNESS_FRAC = 0.025; // pipe thickness as fraction of canvas height
const FLOW_GAP = 0.05;         // horizontal gap between cloud/valve and stock edge
const FLOW_STAGGER = 0.08;     // vertical stagger for multiple flows on same side

/** Auto-contrast: returns "white" or "black" text for readability on the given fill. */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1A1A1A" : "#FFFFFF";
}

/** Darken a color for borders. */
function darkenColor(hex: string): string {
  return brightenColor(hex, -0.25);
}

/** Resolve a NamedColor to CSS hex. */
function resolve(c: NamedColor): string {
  return COLOR_MAP[c];
}

// =============================================================================
// Main layout function
// =============================================================================

export function computeLayout(
  scene: StockFlowScene,
  canvasW: number,
  canvasH: number,
): VisualElement[] {
  const colors = { ...DEFAULT_COLORS, ...scene.colors };
  const elements: VisualElement[] = [];

  const diagramTop = canvasH * TITLE_BAND;
  const diagramH = canvasH - diagramTop;
  const diagramCenterY = diagramTop + diagramH * 0.45;

  // -------------------------------------------------------------------------
  // 1. Title
  // -------------------------------------------------------------------------
  elements.push({
    id: "__title__",
    type: "title",
    x: canvasW * 0.05,
    y: canvasH * 0.02,
    width: canvasW * 0.9,
    height: canvasH * TITLE_BAND * 0.8,
    color: "#1A1A1A",
    label: scene.title,
    state: "hidden",
    progress: 0,
    opacity: 0,
    scale: 1,
    visibleChars: 0,
  });

  // -------------------------------------------------------------------------
  // 2. Order stocks (infer from connections: upstream → downstream)
  // -------------------------------------------------------------------------
  const orderedStocks = orderStocks(scene.system.stocks, scene.system.flows);
  const stockCount = orderedStocks.length;
  const stockW = canvasW * STOCK_W_FRAC * (stockCount <= 2 ? 1 : 0.85);
  const stockH = canvasH * STOCK_H_FRAC;

  // Compute stock center positions
  const stockPositions = new Map<string, { cx: number; cy: number }>();
  for (let i = 0; i < stockCount; i++) {
    const cx = canvasW * getStockX(i, stockCount);
    stockPositions.set(orderedStocks[i].id, { cx, cy: diagramCenterY });
  }

  // Add stock elements
  const stockColor = resolve(colors.stock);
  for (const stock of orderedStocks) {
    const pos = stockPositions.get(stock.id)!;
    elements.push({
      id: stock.id,
      type: "stock",
      x: pos.cx - stockW / 2,
      y: pos.cy - stockH / 2,
      width: stockW,
      height: stockH,
      color: stockColor,
      label: stock.label,
      state: "hidden",
      progress: 0,
      opacity: 0,
      scale: 0,
      textColor: contrastText(stockColor),
      borderColor: darkenColor(stockColor),
    });
  }

  // -------------------------------------------------------------------------
  // 3. Place flows + clouds
  // -------------------------------------------------------------------------
  // Track how many flows are on each side of each stock for staggering
  const inflowCounts = new Map<string, number>();
  const outflowCounts = new Map<string, number>();

  for (const flow of scene.system.flows) {
    const flowColor = resolve(flow.type === "inflow" ? colors.inflow : colors.outflow);
    const pipeThick = canvasH * PIPE_THICKNESS_FRAC;
    const gapPx = canvasW * FLOW_GAP;

    if (flow.type === "inflow") {
      const targetStockId = flow.to_stock!;
      const stockPos = stockPositions.get(targetStockId);
      if (!stockPos) continue;

      const idx = inflowCounts.get(targetStockId) ?? 0;
      inflowCounts.set(targetStockId, idx + 1);
      const yOffset = idx * canvasH * FLOW_STAGGER * (idx % 2 === 0 ? 1 : -1);

      const isFromStock = flow.from_stock && stockPositions.has(flow.from_stock);
      let pipeStartX: number;
      let pipeStartY: number;

      if (isFromStock) {
        // Stock-to-stock flow
        const srcPos = stockPositions.get(flow.from_stock!)!;
        pipeStartX = srcPos.cx + stockW / 2;
        pipeStartY = srcPos.cy + yOffset;
      } else {
        // External inflow — place cloud
        const cloudW = canvasW * CLOUD_W_FRAC;
        const cloudH = canvasH * CLOUD_H_FRAC;
        pipeStartX = stockPos.cx - stockW / 2 - gapPx * 2.5;
        pipeStartY = stockPos.cy + yOffset;
        const cloudCx = pipeStartX - cloudW * 0.6;
        const cloudCy = pipeStartY;

        elements.push(makeCloud(
          `__cloud_${flow.id}__`, flow.id, flowColor,
          cloudCx - cloudW / 2, cloudCy - cloudH / 2, cloudW, cloudH,
        ));
        pipeStartX = cloudCx + cloudW * 0.4;
      }

      const pipeEndX = stockPos.cx - stockW / 2;
      const pipeEndY = stockPos.cy + yOffset;

      elements.push({
        id: flow.id,
        type: "flow",
        x: Math.min(pipeStartX, pipeEndX),
        y: Math.min(pipeStartY, pipeEndY) - pipeThick / 2,
        width: Math.abs(pipeEndX - pipeStartX),
        height: pipeThick,
        color: flowColor,
        label: flow.label,
        state: "hidden",
        progress: 0,
        opacity: 0,
        scale: 1,
        drawProgress: 0,
        pipeStart: { x: pipeStartX, y: pipeStartY },
        pipeEnd: { x: pipeEndX, y: pipeEndY },
        valveMid: { x: (pipeStartX + pipeEndX) / 2, y: (pipeStartY + pipeEndY) / 2 },
        pipeThickness: pipeThick,
        flowColor,
      });

      // Flow label below the pipe
      const labelX = (pipeStartX + pipeEndX) / 2;
      const labelY = Math.max(pipeStartY, pipeEndY) + pipeThick / 2 + 4;
      elements.push({
        id: `__label_${flow.id}__`,
        type: "flow_label",
        x: labelX - 50,
        y: labelY,
        width: 100,
        height: 20,
        color: flowColor,
        label: flow.label,
        state: "hidden",
        progress: 0,
        opacity: 0,
        scale: 1,
        flowId: flow.id,
        textColor: flowColor,
      });

    } else {
      // Outflow
      const sourceStockId = flow.from_stock!;
      const stockPos = stockPositions.get(sourceStockId);
      if (!stockPos) continue;

      const idx = outflowCounts.get(sourceStockId) ?? 0;
      outflowCounts.set(sourceStockId, idx + 1);
      const yOffset = idx * canvasH * FLOW_STAGGER * (idx % 2 === 0 ? 1 : -1);

      const isToStock = flow.to_stock && stockPositions.has(flow.to_stock);
      let pipeEndX: number;
      let pipeEndY: number;

      const pipeStartX = stockPos.cx + stockW / 2;
      const pipeStartY = stockPos.cy + yOffset;

      if (isToStock) {
        const destPos = stockPositions.get(flow.to_stock!)!;
        pipeEndX = destPos.cx - stockW / 2;
        pipeEndY = destPos.cy + yOffset;
      } else {
        const cloudW = canvasW * CLOUD_W_FRAC;
        const cloudH = canvasH * CLOUD_H_FRAC;
        pipeEndX = stockPos.cx + stockW / 2 + gapPx * 2.5;
        pipeEndY = stockPos.cy + yOffset;
        const cloudCx = pipeEndX + cloudW * 0.6;
        const cloudCy = pipeEndY;

        elements.push(makeCloud(
          `__cloud_${flow.id}__`, flow.id, flowColor,
          cloudCx - cloudW / 2, cloudCy - cloudH / 2, cloudW, cloudH,
        ));
        pipeEndX = cloudCx - cloudW * 0.4;
      }

      const pipeThickPx = pipeThick;
      elements.push({
        id: flow.id,
        type: "flow",
        x: Math.min(pipeStartX, pipeEndX),
        y: Math.min(pipeStartY, pipeEndY) - pipeThickPx / 2,
        width: Math.abs(pipeEndX - pipeStartX),
        height: pipeThickPx,
        color: flowColor,
        label: flow.label,
        state: "hidden",
        progress: 0,
        opacity: 0,
        scale: 1,
        drawProgress: 0,
        pipeStart: { x: pipeStartX, y: pipeStartY },
        pipeEnd: { x: pipeEndX, y: pipeEndY },
        valveMid: { x: (pipeStartX + pipeEndX) / 2, y: (pipeStartY + pipeEndY) / 2 },
        pipeThickness: pipeThickPx,
        flowColor,
      });

      const labelX = (pipeStartX + pipeEndX) / 2;
      const labelY = Math.max(pipeStartY, pipeEndY) + pipeThickPx / 2 + 4;
      elements.push({
        id: `__label_${flow.id}__`,
        type: "flow_label",
        x: labelX - 50,
        y: labelY,
        width: 100,
        height: 20,
        color: flowColor,
        label: flow.label,
        state: "hidden",
        progress: 0,
        opacity: 0,
        scale: 1,
        flowId: flow.id,
        textColor: flowColor,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Place converters
  // -------------------------------------------------------------------------
  const converterColor = resolve(colors.converter);
  const converterD = canvasW * CONVERTER_D_FRAC;
  const converters = scene.system.converters ?? [];
  const connectors = scene.system.connectors ?? [];

  for (let i = 0; i < converters.length; i++) {
    const conv = converters[i];
    // Find which flow this converter connects to (via connectors)
    const relatedConnector = connectors.find(c => c.from === conv.id || c.to === conv.id);
    const relatedFlowId = relatedConnector
      ? (relatedConnector.from === conv.id ? relatedConnector.to : relatedConnector.from)
      : null;

    // Find the flow element to position near it
    const flowEl = relatedFlowId ? elements.find(e => e.id === relatedFlowId && e.type === "flow") : null;

    let cx: number, cy: number;
    if (flowEl?.valveMid) {
      // Place above or below the flow valve, alternating
      cx = flowEl.valveMid.x;
      const vertDir = i % 2 === 0 ? -1 : 1;
      cy = flowEl.valveMid.y + vertDir * (canvasH * 0.15);
    } else {
      // Fallback: place above the diagram center
      cx = canvasW * (0.3 + i * 0.15);
      cy = diagramTop + diagramH * 0.15;
    }

    elements.push({
      id: conv.id,
      type: "converter",
      x: cx - converterD / 2,
      y: cy - converterD / 2,
      width: converterD,
      height: converterD,
      color: converterColor,
      label: conv.label,
      state: "hidden",
      progress: 0,
      opacity: 0,
      scale: 0,
      textColor: converterColor,
      borderColor: converterColor,
    });
  }

  // -------------------------------------------------------------------------
  // 5. Place connectors (Bezier curves)
  // -------------------------------------------------------------------------
  const connectorColor = resolve(colors.connector);

  for (const conn of connectors) {
    const fromEl = elements.find(e => e.id === conn.from);
    const toEl = elements.find(e => e.id === conn.to);
    if (!fromEl || !toEl) continue;

    const fromCx = fromEl.x + fromEl.width / 2;
    const fromCy = fromEl.y + fromEl.height / 2;
    const toCx = toEl.type === "flow" && toEl.valveMid
      ? toEl.valveMid.x
      : toEl.x + toEl.width / 2;
    const toCy = toEl.type === "flow" && toEl.valveMid
      ? toEl.valveMid.y
      : toEl.y + toEl.height / 2;

    // Control point: offset perpendicular to the line between source and target
    const midX = (fromCx + toCx) / 2;
    const midY = (fromCy + toCy) / 2;
    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Perpendicular offset (curve away from center line)
    const curvature = Math.min(dist * 0.4, canvasH * 0.15);
    const perpX = -dy / (dist || 1) * curvature;
    const perpY = dx / (dist || 1) * curvature;

    const controlX = midX + perpX;
    const controlY = midY + perpY;

    // Arrow angle at the end point
    const arrowAngle = Math.atan2(toCy - controlY, toCx - controlX);

    elements.push({
      id: `__conn_${conn.from}_${conn.to}__`,
      type: "connector",
      // Bounding box (approximate)
      x: Math.min(fromCx, toCx, controlX) - 10,
      y: Math.min(fromCy, toCy, controlY) - 10,
      width: Math.abs(Math.max(fromCx, toCx, controlX) - Math.min(fromCx, toCx, controlX)) + 20,
      height: Math.abs(Math.max(fromCy, toCy, controlY) - Math.min(fromCy, toCy, controlY)) + 20,
      color: connectorColor,
      label: conn.label,
      state: "hidden",
      progress: 0,
      opacity: 0,
      scale: 1,
      drawProgress: 0,
      curveStart: { x: fromCx, y: fromCy },
      curveEnd: { x: toCx, y: toCy },
      curveControl: { x: controlX, y: controlY },
      arrowAngle,
    });
  }

  return elements;
}

// =============================================================================
// Helpers
// =============================================================================

function getStockX(index: number, total: number): number {
  if (total === 1) return 0.50;
  if (total === 2) return [0.33, 0.67][index];
  return [0.25, 0.50, 0.75][index];
}

function makeCloud(
  id: string, flowId: string, flowColor: string,
  x: number, y: number, w: number, h: number,
): VisualElement {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.35;
  return {
    id,
    type: "cloud",
    x, y, width: w, height: h,
    color: flowColor + "33", // 20% opacity via hex alpha
    label: undefined,
    state: "hidden",
    progress: 0,
    opacity: 0,
    scale: 1,
    flowId,
    cloudCircles: [
      { cx: cx - r * 0.5, cy: cy + r * 0.2, r: r * 0.9 },
      { cx: cx + r * 0.4, cy: cy + r * 0.1, r: r * 0.8 },
      { cx: cx - r * 0.1, cy: cy - r * 0.3, r: r * 0.7 },
      { cx: cx + r * 0.8, cy: cy - r * 0.1, r: r * 0.6 },
    ],
    borderColor: flowColor + "66", // 40% opacity
  };
}

/**
 * Order stocks from upstream to downstream by analyzing flow connections.
 * A stock that only has outflows or feeds into other stocks goes first.
 */
function orderStocks(stocks: Stock[], flows: Flow[]): Stock[] {
  if (stocks.length <= 1) return [...stocks];

  // Build adjacency: stock A → stock B means there's a flow from A to B
  const downstream = new Map<string, Set<string>>();
  for (const s of stocks) downstream.set(s.id, new Set());

  for (const f of flows) {
    if (f.from_stock && f.to_stock) {
      downstream.get(f.from_stock)?.add(f.to_stock);
    }
  }

  // Simple topological sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const s of stocks) inDegree.set(s.id, 0);
  for (const [, targets] of downstream) {
    for (const t of targets) {
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const ordered: Stock[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    ordered.push(stocks.find(s => s.id === id)!);
    for (const next of downstream.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  // Fallback: append any stocks not reached by topo sort (no connections)
  for (const s of stocks) {
    if (!visited.has(s.id)) ordered.push(s);
  }

  return ordered;
}
