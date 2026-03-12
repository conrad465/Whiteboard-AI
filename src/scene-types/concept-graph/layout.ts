// =============================================================================
// Concept Graph Layout Engine
//
// Takes a ConceptGraphScene and canvas dimensions, produces positioned
// VisualElements. Implements Sugiyama-style layered layout with cycle
// detection and circular layout for pure cycles.
// =============================================================================

import type {
  ConceptGraphScene, VisualElement, GraphNode, GraphEdge,
} from "./types";
import { DEFAULT_STYLE } from "./types";
import { COLOR_MAP, brightenColor } from "../../schema/colors";
import type { NamedColor } from "../../schema/types";

// Layout constants
const TITLE_BAND = 0.08;
const PADDING = 0.05;

type Point = { x: number; y: number };

/** Auto-contrast: white on dark fills, black on light fills. */
function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1A1A1A" : "#FFFFFF";
}

function darkenColor(hex: string): string {
  return brightenColor(hex, -0.25);
}

function resolve(c: NamedColor): string {
  return COLOR_MAP[c];
}

// =============================================================================
// Main layout function
// =============================================================================

export function computeLayout(
  scene: ConceptGraphScene,
  canvasW: number,
  canvasH: number,
): VisualElement[] {
  const style = { ...DEFAULT_STYLE, ...scene.style };
  const elements: VisualElement[] = [];
  const nodes = scene.graph.nodes;
  const edges = scene.graph.edges;

  // Title element
  elements.push({
    id: "__title__",
    type: "title",
    x: canvasW * PADDING,
    y: canvasH * 0.01,
    width: canvasW * (1 - 2 * PADDING),
    height: canvasH * TITLE_BAND * 0.9,
    color: "#1A1A1A",
    label: scene.title,
    state: "hidden",
    progress: 0,
    opacity: 0,
    scale: 1,
    visibleChars: 0,
  });

  // Diagram area
  const dTop = canvasH * (TITLE_BAND + PADDING);
  const dLeft = canvasW * PADDING;
  const dWidth = canvasW * (1 - 2 * PADDING);
  const dHeight = canvasH * (1 - TITLE_BAND - 2 * PADDING);

  // Resolve colors
  const nodeColor = resolve(style.palette);
  const edgeColor = resolve(style.edge_color);

  // Compute group color shades
  const groupColors = computeGroupColors(nodes, nodeColor);

  // Choose layout strategy
  const nodeCount = nodes.length;
  let nodePositions: Map<string, { cx: number; cy: number; w: number; h: number }>;

  if (nodeCount <= 3) {
    nodePositions = layoutHorizontal(nodes, dLeft, dTop, dWidth, dHeight);
  } else if (isPureCycle(nodes, edges)) {
    nodePositions = layoutCircular(nodes, edges, dLeft, dTop, dWidth, dHeight);
  } else {
    nodePositions = layoutLayered(nodes, edges, dLeft, dTop, dWidth, dHeight);
  }

  // Create node visual elements
  for (const node of nodes) {
    const pos = nodePositions.get(node.id);
    if (!pos) continue;

    const fill = groupColors.get(node.id) ?? nodeColor;
    elements.push({
      id: node.id,
      type: "node",
      x: pos.cx - pos.w / 2,
      y: pos.cy - pos.h / 2,
      width: pos.w,
      height: pos.h,
      color: fill,
      label: node.label,
      state: "hidden",
      progress: 0,
      opacity: 0,
      scale: 0,
      borderColor: darkenColor(fill),
      textColor: contrastText(fill),
    });
  }

  // Create edge visual elements
  for (const edge of edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const edgeId = `__edge_${edge.from}_${edge.to}__`;

    // Compute attachment points on box borders
    const start = boxBorderPoint(fromPos, toPos);
    const end = boxBorderPoint(toPos, fromPos);

    // Determine if edge needs to be curved
    const sameLayer = areSameLayer(edge.from, edge.to, nodes, edges);
    const selfLoop = edge.from === edge.to;
    const isCurved = sameLayer || selfLoop;

    let control: Point | undefined;
    let arrowAngle: number;

    if (selfLoop) {
      // Self-loop: arc above the node
      control = { x: fromPos.cx, y: fromPos.cy - fromPos.h * 1.5 };
      arrowAngle = Math.PI / 2;
    } else if (isCurved) {
      // Same-layer edge: arc above or below
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const offset = Math.min(dist * 0.5, canvasH * 0.12);
      // Perpendicular offset
      control = { x: midX - (dy / dist) * offset, y: midY + (dx / dist) * offset };
      arrowAngle = Math.atan2(end.y - control.y, end.x - control.x);
    } else {
      arrowAngle = Math.atan2(end.y - start.y, end.x - start.x);
    }

    elements.push({
      id: edgeId,
      type: "edge",
      x: Math.min(start.x, end.x, control?.x ?? start.x) - 10,
      y: Math.min(start.y, end.y, control?.y ?? start.y) - 10,
      width: Math.abs(Math.max(start.x, end.x, control?.x ?? end.x) - Math.min(start.x, end.x, control?.x ?? start.x)) + 20,
      height: Math.abs(Math.max(start.y, end.y, control?.y ?? end.y) - Math.min(start.y, end.y, control?.y ?? start.y)) + 20,
      color: edgeColor,
      label: edge.label,
      state: "hidden",
      progress: 0,
      opacity: 0,
      scale: 1,
      drawProgress: 0,
      edgeStart: start,
      edgeEnd: end,
      edgeControl: control,
      isCurved,
      arrowAngle,
      fromNodeId: edge.from,
      toNodeId: edge.to,
    });
  }

  return elements;
}

// =============================================================================
// Layout strategies
// =============================================================================

/** Simple horizontal layout for <=3 nodes */
function layoutHorizontal(
  nodes: GraphNode[],
  dLeft: number, dTop: number, dWidth: number, dHeight: number,
): Map<string, { cx: number; cy: number; w: number; h: number }> {
  const positions = new Map<string, { cx: number; cy: number; w: number; h: number }>();
  const n = nodes.length;
  const nodeW = Math.min(dWidth * 0.16, dWidth / (n + 1));
  const nodeH = nodeW * 0.6;
  const centerY = dTop + dHeight / 2;

  for (let i = 0; i < n; i++) {
    const cx = dLeft + dWidth * ((i + 1) / (n + 1));
    positions.set(nodes[i].id, { cx, cy: centerY, w: nodeW, h: nodeH });
  }
  return positions;
}

/** Circular layout for pure cycle graphs (flywheels) */
function layoutCircular(
  nodes: GraphNode[], edges: GraphEdge[],
  dLeft: number, dTop: number, dWidth: number, dHeight: number,
): Map<string, { cx: number; cy: number; w: number; h: number }> {
  const positions = new Map<string, { cx: number; cy: number; w: number; h: number }>();
  const n = nodes.length;

  // Adaptive node size
  const nodeW = Math.max(80, Math.min(dWidth * 0.14, dWidth * 0.16 * (6 / Math.max(n, 1))));
  const nodeH = nodeW * 0.6;

  const centerX = dLeft + dWidth / 2;
  const centerY = dTop + dHeight / 2;
  const radiusX = (dWidth / 2) * 0.65;
  const radiusY = (dHeight / 2) * 0.65;

  // Order nodes along the cycle
  const orderedIds = orderCycleNodes(nodes, edges);

  for (let i = 0; i < orderedIds.length; i++) {
    // Start from top, go clockwise
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / orderedIds.length;
    const cx = centerX + radiusX * Math.cos(angle);
    const cy = centerY + radiusY * Math.sin(angle);
    positions.set(orderedIds[i], { cx, cy, w: nodeW, h: nodeH });
  }

  // Handle non-cycle nodes (nodes with edges into the cycle but not part of it)
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    // Place near the connected cycle node
    const connectedEdge = edges.find(e => e.to === node.id || e.from === node.id);
    const targetId = connectedEdge
      ? (connectedEdge.from === node.id ? connectedEdge.to : connectedEdge.from)
      : null;
    const targetPos = targetId ? positions.get(targetId) : null;
    if (targetPos) {
      // Place inside/near the target
      const offsetX = (targetPos.cx - centerX) * 0.4;
      const offsetY = (targetPos.cy - centerY) * 0.4;
      positions.set(node.id, {
        cx: centerX + offsetX,
        cy: centerY + offsetY,
        w: nodeW, h: nodeH,
      });
    } else {
      positions.set(node.id, { cx: centerX, cy: centerY, w: nodeW, h: nodeH });
    }
  }

  return positions;
}

/** Sugiyama-style layered layout for general directed graphs */
function layoutLayered(
  nodes: GraphNode[], edges: GraphEdge[],
  dLeft: number, dTop: number, dWidth: number, dHeight: number,
): Map<string, { cx: number; cy: number; w: number; h: number }> {
  const positions = new Map<string, { cx: number; cy: number; w: number; h: number }>();
  const n = nodes.length;

  // Step 1: Break cycles via DFS
  const { dagEdges } = breakCycles(nodes, edges);

  // Step 2: Assign layers via topological sort
  const layers = assignLayers(nodes, dagEdges);

  // Step 3: Order nodes within layers to minimize crossings
  orderWithinLayers(layers, dagEdges);

  // Step 4: Position nodes
  const layerCount = layers.length;
  const nodeW = Math.max(80, Math.min(dWidth * 0.14, dWidth * 0.16 * (6 / Math.max(n, 1))));
  const nodeH = Math.max(48, nodeW * 0.6);

  for (let li = 0; li < layerCount; li++) {
    const layer = layers[li];
    const layerX = dLeft + dWidth * ((li + 0.5) / layerCount);
    const nodesInLayer = layer.length;

    for (let ni = 0; ni < nodesInLayer; ni++) {
      const cy = dTop + dHeight * ((ni + 1) / (nodesInLayer + 1));
      positions.set(layer[ni], { cx: layerX, cy, w: nodeW, h: nodeH });
    }
  }

  // Step 5: Collision avoidance — push overlapping nodes apart
  resolveOverlaps(positions, nodeH);

  return positions;
}

// =============================================================================
// Graph analysis helpers
// =============================================================================

/** Check if the graph is a pure single cycle (every node has exactly 1 in-edge and 1 out-edge) */
function isPureCycle(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  if (nodes.length < 3) return false;

  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of nodes) {
    inDeg.set(n.id, 0);
    outDeg.set(n.id, 0);
  }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  }

  // Check if at least one full cycle exists (nodes with in=1, out=1)
  const cycleNodes = nodes.filter(n =>
    inDeg.get(n.id) === 1 && outDeg.get(n.id) === 1
  );

  // Pure cycle: all cycle nodes form a connected cycle covering most nodes
  return cycleNodes.length >= nodes.length - 2 && cycleNodes.length >= 3;
}

/** Order nodes along a cycle by following edges */
function orderCycleNodes(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const outMap = new Map<string, string>();
  for (const e of edges) {
    // Only track cycle edges (nodes with exactly 1 in, 1 out)
    outMap.set(e.from, e.to);
  }

  const ordered: string[] = [];
  const visited = new Set<string>();
  let current = nodes[0].id;

  for (let i = 0; i < nodes.length; i++) {
    if (visited.has(current)) break;
    visited.add(current);
    ordered.push(current);
    const next = outMap.get(current);
    if (!next) break;
    current = next;
  }

  // Add any remaining nodes not in the cycle
  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push(n.id);
  }

  return ordered;
}

/** Break cycles via DFS, returning a DAG */
function breakCycles(
  nodes: GraphNode[], edges: GraphEdge[],
): { dagEdges: GraphEdge[]; reversedEdges: Set<string> } {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);

  const reversedEdges = new Set<string>();

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        // Back edge — mark for reversal
        reversedEdges.add(`${u}->${v}`);
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) dfs(n.id);
  }

  // Build DAG edges (reverse the back edges)
  const dagEdges = edges.map(e => {
    if (reversedEdges.has(`${e.from}->${e.to}`)) {
      return { ...e, from: e.to, to: e.from };
    }
    return e;
  });

  return { dagEdges, reversedEdges };
}

/** Assign layers via topological sort */
function assignLayers(nodes: GraphNode[], dagEdges: GraphEdge[]): string[][] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of dagEdges) {
    adj.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  // Topological sort (Kahn's)
  const queue: string[] = [];
  for (const n of nodes) {
    if (inDeg.get(n.id) === 0) queue.push(n.id);
  }

  const layerOf = new Map<string, number>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    const uLayer = layerOf.get(u) ?? 0;
    for (const v of adj.get(u) ?? []) {
      layerOf.set(v, Math.max(layerOf.get(v) ?? 0, uLayer + 1));
      const newDeg = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
    if (!layerOf.has(u)) layerOf.set(u, 0);
  }

  // Handle nodes not reached (isolated or in remaining cycles)
  for (const n of nodes) {
    if (!layerOf.has(n.id)) layerOf.set(n.id, 0);
  }

  // Group by layer
  const maxLayer = Math.max(0, ...Array.from(layerOf.values()));
  const layers: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) layers.push([]);
  for (const n of nodes) {
    layers[layerOf.get(n.id) ?? 0].push(n.id);
  }

  // Remove empty layers
  return layers.filter(l => l.length > 0);
}

/** Minimize edge crossings by ordering nodes within layers (barycenter heuristic) */
function orderWithinLayers(layers: string[][], dagEdges: GraphEdge[]): void {
  if (layers.length <= 1) return;

  // Build adjacency for neighbor lookup
  const leftNeighbors = new Map<string, string[]>();
  const rightNeighbors = new Map<string, string[]>();
  for (const e of dagEdges) {
    if (!rightNeighbors.has(e.from)) rightNeighbors.set(e.from, []);
    rightNeighbors.get(e.from)!.push(e.to);
    if (!leftNeighbors.has(e.to)) leftNeighbors.set(e.to, []);
    leftNeighbors.get(e.to)!.push(e.from);
  }

  // 3 passes of barycenter ordering
  for (let pass = 0; pass < 3; pass++) {
    // Forward pass
    for (let li = 1; li < layers.length; li++) {
      const prevOrder = new Map<string, number>();
      layers[li - 1].forEach((id, idx) => prevOrder.set(id, idx));

      layers[li].sort((a, b) => {
        const aNeighbors = leftNeighbors.get(a) ?? [];
        const bNeighbors = leftNeighbors.get(b) ?? [];
        const aBar = aNeighbors.length > 0
          ? aNeighbors.reduce((s, n) => s + (prevOrder.get(n) ?? 0), 0) / aNeighbors.length
          : 0;
        const bBar = bNeighbors.length > 0
          ? bNeighbors.reduce((s, n) => s + (prevOrder.get(n) ?? 0), 0) / bNeighbors.length
          : 0;
        return aBar - bBar;
      });
    }

    // Backward pass
    for (let li = layers.length - 2; li >= 0; li--) {
      const nextOrder = new Map<string, number>();
      layers[li + 1].forEach((id, idx) => nextOrder.set(id, idx));

      layers[li].sort((a, b) => {
        const aNeighbors = rightNeighbors.get(a) ?? [];
        const bNeighbors = rightNeighbors.get(b) ?? [];
        const aBar = aNeighbors.length > 0
          ? aNeighbors.reduce((s, n) => s + (nextOrder.get(n) ?? 0), 0) / aNeighbors.length
          : 0;
        const bBar = bNeighbors.length > 0
          ? bNeighbors.reduce((s, n) => s + (nextOrder.get(n) ?? 0), 0) / bNeighbors.length
          : 0;
        return aBar - bBar;
      });
    }
  }
}

/** Check if two nodes are in the same layer (approximate) */
function areSameLayer(
  _fromId: string, _toId: string, _nodes: GraphNode[], _edges: GraphEdge[],
): boolean {
  // For now, return false — layered layout handles cross-layer edges as straight arrows
  return false;
}

/** Push overlapping nodes apart vertically */
function resolveOverlaps(
  positions: Map<string, { cx: number; cy: number; w: number; h: number }>,
  minGap: number,
): void {
  const entries = Array.from(positions.entries());
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [, a] = entries[i];
      const [, b] = entries[j];
      const overlapX = (a.w / 2 + b.w / 2) - Math.abs(a.cx - b.cx);
      const overlapY = (a.h / 2 + b.h / 2 + minGap * 0.2) - Math.abs(a.cy - b.cy);
      if (overlapX > 0 && overlapY > 0) {
        // Push apart vertically
        const pushY = overlapY / 2 + 5;
        if (a.cy < b.cy) {
          a.cy -= pushY;
          b.cy += pushY;
        } else {
          a.cy += pushY;
          b.cy -= pushY;
        }
      }
    }
  }
}

// =============================================================================
// Edge attachment: compute point on box border facing the other box
// =============================================================================

function boxBorderPoint(
  from: { cx: number; cy: number; w: number; h: number },
  to: { cx: number; cy: number; w: number; h: number },
): Point {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const halfW = from.w / 2;
  const halfH = from.h / 2;

  if (dx === 0 && dy === 0) return { x: from.cx + halfW, y: from.cy };

  // Find intersection with box border
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let t: number;
  if (absDx * halfH > absDy * halfW) {
    // Hits left or right side
    t = halfW / absDx;
  } else {
    // Hits top or bottom
    t = halfH / absDy;
  }

  return { x: from.cx + dx * t, y: from.cy + dy * t };
}

// =============================================================================
// Group color computation
// =============================================================================

function computeGroupColors(nodes: GraphNode[], baseColor: string): Map<string, string> {
  const colors = new Map<string, string>();
  const groups = new Set<string>();

  for (const n of nodes) {
    if (n.group) groups.add(n.group);
  }

  if (groups.size <= 1) return colors; // All same color

  const groupList = Array.from(groups);
  const shadeSteps = [-0.15, 0, 0.15, 0.3];

  for (let i = 0; i < groupList.length; i++) {
    const shade = brightenColor(baseColor, shadeSteps[i % shadeSteps.length]);
    for (const n of nodes) {
      if (n.group === groupList[i]) {
        colors.set(n.id, shade);
      }
    }
  }

  return colors;
}
