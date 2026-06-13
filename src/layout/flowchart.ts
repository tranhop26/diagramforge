/**
 * Flowchart layout.
 *
 * Pure function: `FlowchartIR → FlowchartGeometry`.
 *
 * Algorithm:
 *
 *   1. Rank assignment (longest-path from a virtual source) using a
 *      deterministic DFS. Back-edges introduced by the ranker are
 *      ignored — we always treat the input as a DAG; cycles would
 *      indicate malformed input and we degrade to a single rank.
 *   2. Within each rank, sort nodes by id and lay them out in a
 *      single row with even x-spacing.
 *   3. Node width is computed from the label length (chars × CHAR_WIDTH
 *      + padding) with a minimum.
 *   4. Edges are routed as orthogonal polylines:
 *        source bottom-center → (sx, sourceBottom + GAP/2) →
 *        (tx, sourceBottom + GAP/2) → (tx, targetTop − GAP/2) →
 *        target top-center
 *      The polyline has 5 anchor points and renders as a clean step.
 *
 * The output is fully deterministic: same IR in, same geometry out.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_MARGIN,
  CANVAS_WIDTH,
  CHAR_WIDTH,
  COL_GAP,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  NODE_PADDING_X,
  ROW_GAP,
} from './constants.js';
import type {
  FlowchartEdgeGeometry,
  FlowchartGeometry,
  FlowchartNodeGeometry,
} from './types.js';
import type { FlowchartIR } from '../types.js';

interface InternalNode {
  readonly id: string;
  readonly label: string;
  readonly shape: FlowchartIR['nodes'][number]['shape'];
}

interface RankedNode {
  readonly node: InternalNode;
  readonly rank: number;
}

/** Compute node w/h from a label, with minimums. */
function nodeSize(label: string): { w: number; h: number } {
  const w = Math.max(MIN_NODE_WIDTH, label.length * CHAR_WIDTH + NODE_PADDING_X * 2);
  const h = MIN_NODE_HEIGHT;
  return { w, h };
}

/**
 * Assign each node a rank (its row index, 0 = top) using the
 * longest-path layering. DFS in id-sorted order so the result is
 * deterministic; cycles degrade to rank 0.
 */
function assignRanks(
  nodes: ReadonlyArray<InternalNode>,
  edges: ReadonlyArray<FlowchartIR['edges'][number]>,
): RankedNode[] {
  const out = new Map<string, number>();
  const sortedNodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Build adjacency: from-id → [to-ids], sorted by to-id.
  const adj = new Map<string, string[]>();
  for (const n of sortedNodes) adj.set(n.id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) {
      if (!list.includes(e.to)) list.push(e.to);
    }
  }
  for (const list of adj.values()) {
    list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const cached = out.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) {
      // Cycle — degrade to rank 0 so we always make progress.
      return 0;
    }
    visiting.add(id);
    let best = 0;
    for (const child of adj.get(id) ?? []) {
      const r = visit(child) + 1;
      if (r > best) best = r;
    }
    visiting.delete(id);
    out.set(id, best);
    return best;
  };

  for (const n of sortedNodes) visit(n.id);
  return sortedNodes.map((n) => ({ node: n, rank: out.get(n.id) ?? 0 }));
}

export function layoutFlowchart(ir: FlowchartIR): FlowchartGeometry {
  // Ensure every endpoint of an edge is present as a node (the DSL
  // parser already does this; the LLM path is the only one that can
  // omit it, and we still want a clean geometry).
  const nodeIds = new Set(ir.nodes.map((n) => n.id));
  const normalisedNodes: InternalNode[] = ir.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    shape: n.shape,
  }));
  for (const e of ir.edges) {
    if (!nodeIds.has(e.from)) {
      normalisedNodes.push({ id: e.from, label: e.from, shape: 'box' });
      nodeIds.add(e.from);
    }
    if (!nodeIds.has(e.to)) {
      normalisedNodes.push({ id: e.to, label: e.to, shape: 'box' });
      nodeIds.add(e.to);
    }
  }

  const ranked = assignRanks(normalisedNodes, ir.edges);
  // Group by rank.
  const byRank = new Map<number, InternalNode[]>();
  for (const r of ranked) {
    const list = byRank.get(r.rank) ?? [];
    list.push(r.node);
    byRank.set(r.rank, list);
  }
  for (const list of byRank.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  // Compute positions per node, grouped by rank. Within a rank, we
  // pack nodes left-to-right with COL_GAP between them.
  const nodeGeom = new Map<string, FlowchartNodeGeometry>();
  const rowWidths = ranks.map((rank) => {
    const list = byRank.get(rank) ?? [];
    let total = 0;
    for (const n of list) {
      const { w } = nodeSize(n.label);
      total += w;
    }
    total += Math.max(0, list.length - 1) * COL_GAP;
    return total;
  });
  const maxRowWidth = Math.max(...rowWidths, 0);
  const rowHeights: number[] = ranks.map((rank) => {
    const list = byRank.get(rank) ?? [];
    return list.reduce((m, n) => Math.max(m, nodeSize(n.label).h), 0);
  });
  const totalHeight =
    rowHeights.reduce((s, h) => s + h, 0) + Math.max(0, ranks.length - 1) * ROW_GAP;
  const canvasH = Math.max(totalHeight + 2 * CANVAS_MARGIN, CANVAS_MARGIN * 2 + 40);
  const canvasW = Math.max(maxRowWidth + 2 * CANVAS_MARGIN, CANVAS_WIDTH);

  let yCursor = CANVAS_MARGIN;
  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i]!;
    const list = byRank.get(rank) ?? [];
    const rowH = rowHeights[i]!;
    const rowW = rowWidths[i]!;
    let xCursor = CANVAS_MARGIN + Math.max(0, (maxRowWidth - rowW) / 2);
    for (const n of list) {
      const { w, h } = nodeSize(n.label);
      const y = yCursor + Math.max(0, (rowH - h) / 2);
      nodeGeom.set(n.id, {
        id: n.id,
        label: n.label,
        shape: n.shape,
        x: xCursor,
        y,
        w,
        h,
      });
      xCursor += w + COL_GAP;
    }
    yCursor += rowH + ROW_GAP;
  }

  // Build edge geometries. Sort by (from, to) for determinism.
  const edgeGeoms: FlowchartEdgeGeometry[] = [];
  const sortedEdges = [...ir.edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
  });
  let edgeId = 0;
  for (const e of sortedEdges) {
    const fromN = nodeGeom.get(e.from);
    const toN = nodeGeom.get(e.to);
    if (!fromN || !toN) continue;
    const sx = fromN.x + fromN.w / 2;
    const sy = fromN.y + fromN.h;
    const tx = toN.x + toN.w / 2;
    const ty = toN.y;
    const midY1 = sy + ROW_GAP / 2;
    const midY2 = ty - ROW_GAP / 2;
    const points = [
      { x: sx, y: sy },
      { x: sx, y: midY1 },
      { x: tx, y: midY1 },
      { x: tx, y: midY2 },
      { x: tx, y: ty },
    ];
    edgeGeoms.push({
      id: `e${edgeId++}`,
      from: e.from,
      to: e.to,
      label: e.label ?? '',
      points,
      kind: 'flow',
    });
  }

  return {
    kind: 'flowchart',
    width: canvasW,
    height: Math.max(canvasH, CANVAS_HEIGHT),
    nodes: [...nodeGeom.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    edges: edgeGeoms,
    title: ir.title,
  };
}
