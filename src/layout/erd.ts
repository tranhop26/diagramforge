/**
 * ERD layout.
 *
 * Pure function: `ErdIR → ErdGeometry`.
 *
 * Layout:
 *   - Entities are placed on a `ceil(sqrt(N))` grid (rows × cols)
 *     with a fixed gap.
 *   - Each table is a rectangle: a header band carrying the entity
 *     label, then one row per attribute.
 *   - Width is `max(180, label.length × CHAR_WIDTH + padding)`.
 *   - Relations are straight lines from the border of one table to
 *     the border of the other. Cardinality labels sit at each end.
 *
 * Determinism: entities and relations are sorted by id for layout
 * and emission.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_MARGIN,
  CANVAS_WIDTH,
  CHAR_WIDTH,
  ERD_GRID_GAP_X,
  ERD_GRID_GAP_Y,
  ERD_HEADER_BAND,
  ERD_ROW_HEIGHT,
  NODE_PADDING_X,
} from './constants.js';
import type {
  ErdEntityGeometry,
  ErdGeometry,
  ErdRelationGeometry,
} from './types.js';
import type { ErdIR } from '../types.js';

const MIN_TABLE_WIDTH = 180;

function tableWidth(label: string): number {
  return Math.max(MIN_TABLE_WIDTH, label.length * CHAR_WIDTH + NODE_PADDING_X * 2);
}

export function layoutErd(ir: ErdIR): ErdGeometry {
  // Ensure all relation endpoints are present as entities.
  const seen = new Set(ir.entities.map((e) => e.id));
  const entities = [...ir.entities];
  for (const r of ir.relations) {
    if (!seen.has(r.from)) {
      entities.push({ id: r.from, label: r.from, attributes: [] });
      seen.add(r.from);
    }
    if (!seen.has(r.to)) {
      entities.push({ id: r.to, label: r.to, attributes: [] });
      seen.add(r.to);
    }
  }
  const sortedEntities = [...entities].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const n = sortedEntities.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));

  // Compute per-table size to keep the grid aligned.
  const sizes = sortedEntities.map((e) => {
    const w = tableWidth(e.label);
    const h = ERD_HEADER_BAND + Math.max(1, e.attributes.length) * ERD_ROW_HEIGHT;
    return { w, h };
  });
  // Pick the max w per column, the max h per row.
  const colMaxW: number[] = new Array(cols).fill(0);
  const rowMaxH: number[] = new Array(rows).fill(0);
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    if (sizes[i]!.w > colMaxW[c]!) colMaxW[c] = sizes[i]!.w;
    if (sizes[i]!.h > rowMaxH[r]!) rowMaxH[r] = sizes[i]!.h;
  }
  const colOffsets: number[] = new Array(cols).fill(0);
  for (let c = 1; c < cols; c++) {
    colOffsets[c] = colOffsets[c - 1]! + colMaxW[c - 1]! + ERD_GRID_GAP_X;
  }
  const rowOffsets: number[] = new Array(rows).fill(0);
  for (let r = 1; r < rows; r++) {
    rowOffsets[r] = rowOffsets[r - 1]! + rowMaxH[r - 1]! + ERD_GRID_GAP_Y;
  }

  const entityGeoms: ErdEntityGeometry[] = sortedEntities.map((e, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const w = sizes[i]!.w;
    const h = sizes[i]!.h;
    const x = CANVAS_MARGIN + colOffsets[c]!;
    const y = CANVAS_MARGIN + rowOffsets[r]!;
    const rows2 = e.attributes.map((label, idx) => ({
      label,
      y: y + ERD_HEADER_BAND + idx * ERD_ROW_HEIGHT,
      h: ERD_ROW_HEIGHT,
    }));
    return {
      id: e.id,
      label: e.label,
      x,
      y,
      w,
      h,
      rows: rows2,
    };
  });

  const totalW =
    colMaxW.reduce((s, w) => s + w, 0) +
    Math.max(0, cols - 1) * ERD_GRID_GAP_X +
    2 * CANVAS_MARGIN;
  const totalH =
    rowMaxH.reduce((s, h) => s + h, 0) +
    Math.max(0, rows - 1) * ERD_GRID_GAP_Y +
    2 * CANVAS_MARGIN;
  const canvasW = Math.max(totalW, CANVAS_WIDTH);
  const canvasH = Math.max(totalH, CANVAS_HEIGHT);

  // Relations: straight line from source border midpoint to target
  // border midpoint. Pick the closest side (left/right/top/bottom)
  // for each end so the line is the shortest axis-aligned segment.
  const relationGeoms: ErdRelationGeometry[] = [];
  const sortedRels = [...ir.relations].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
  });
  for (const r of sortedRels) {
    const fromE = entityGeoms.find((e) => e.id === r.from);
    const toE = entityGeoms.find((e) => e.id === r.to);
    if (!fromE || !toE) continue;
    const fromCx = fromE.x + fromE.w / 2;
    const fromCy = fromE.y + fromE.h / 2;
    const toCx = toE.x + toE.w / 2;
    const toCy = toE.y + toE.h / 2;
    let p1: { x: number; y: number };
    let p2: { x: number; y: number };
    if (Math.abs(toCx - fromCx) >= Math.abs(toCy - fromCy)) {
      // Horizontal primary.
      const fromSide = toCx >= fromCx ? fromE.x + fromE.w : fromE.x;
      const toSide = toCx >= fromCx ? toE.x : toE.x + toE.w;
      p1 = { x: fromSide, y: fromCy };
      p2 = { x: toSide, y: toCy };
    } else {
      // Vertical primary.
      const fromSide = toCy >= fromCy ? fromE.y + fromE.h : fromE.y;
      const toSide = toCy >= fromCy ? toE.y : toE.y + toE.h;
      p1 = { x: fromCx, y: fromSide };
      p2 = { x: toCx, y: toSide };
    }
    relationGeoms.push({
      from: r.from,
      to: r.to,
      label: r.label ?? '',
      fromCard: r.fromCard,
      toCard: r.toCard,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
    });
  }

  return {
    kind: 'erd',
    width: canvasW,
    height: canvasH,
    entities: entityGeoms,
    relations: relationGeoms,
    title: ir.title,
  };
}
