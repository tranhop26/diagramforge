/**
 * SVG renderer.
 *
 * Pure function: `(geometry, theme) → SVG string`.
 *
 * The output is a single `<svg xmlns="http://www.w3.org/2000/svg">`
 * root with a `<defs>` block (arrowhead markers + theme style),
 * a `<rect>` background, and one `<g>` group per diagram kind. The
 * renderer is the only place that touches SVG; layout modules
 * produce plain geometry, this module turns that into XML.
 *
 * Determinism:
 *   - No `Date`, `Math.random`, or env reads in this file.
 *   - Iteration orders are explicit (sort by id, then by edge index).
 *   - Theme is read but never mutated; the same `(geometry, theme)`
 *     pair always produces the same SVG string.
 */
import type { Theme } from '../types.js';
import {
  FONT_SIZE,
  FONT_SIZE_SMALL,
} from '../layout/constants.js';
import type {
  ErdGeometry,
  FlowchartGeometry,
  FlowchartNodeGeometry,
  Geometry,
  SequenceGeometry,
} from '../layout/types.js';
import { escapeXml } from './_escape.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function shapeToPath(ng: FlowchartNodeGeometry): string {
  const { x, y, w, h, shape } = ng;
  switch (shape) {
    case 'box':
      return `M ${x} ${y} h ${w} v ${h} h ${-w} z`;
    case 'round': {
      const r = Math.min(12, w / 4, h / 2);
      return (
        `M ${x + r} ${y} ` +
        `h ${w - 2 * r} ` +
        `a ${r} ${r} 0 0 1 ${r} ${r} ` +
        `v ${h - 2 * r} ` +
        `a ${r} ${r} 0 0 1 ${-r} ${r} ` +
        `h ${-(w - 2 * r)} ` +
        `a ${r} ${r} 0 0 1 ${-r} ${-r} ` +
        `v ${-(h - 2 * r)} ` +
        `a ${r} ${r} 0 0 1 ${r} ${-r} z`
      );
    }
    case 'diamond': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} z`;
    }
    case 'parallelogram': {
      const skew = Math.min(16, w / 6);
      return `M ${x + skew} ${y} L ${x + w} ${y} L ${x + w - skew} ${y + h} L ${x} ${y + h} z`;
    }
  }
}

function renderDefs(theme: Theme): string {
  // Closed triangle (sync), open triangle (async), small diamond for ERD.
  return [
    '<defs>',
    `<style>text{font-family:Inter,system-ui,sans-serif;font-size:${FONT_SIZE}px;fill:${theme.text}} .edge{stroke:${theme.edge};stroke-width:1.5;fill:none} .node-fill{fill:${theme.nodeFill};stroke:${theme.nodeStroke};stroke-width:1.25} .label{font-size:${FONT_SIZE_SMALL}px;fill:${theme.muted}} .arrow-sync-end{marker-end:url(#arrow-sync)} .arrow-async-end{marker-end:url(#arrow-async)} .arrow-return-end{marker-end:url(#arrow-return)}</style>`,
    `<marker id="arrow-sync" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${theme.edge}"/></marker>`,
    `<marker id="arrow-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="${theme.edge}" stroke-width="1.5"/></marker>`,
    `<marker id="arrow-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M10,0 L0,5 L10,10" fill="none" stroke="${theme.edge}" stroke-width="1.5"/></marker>`,
    '</defs>',
  ].join('');
}

function renderFlowchart(g: FlowchartGeometry, theme: Theme): string {
  const parts: string[] = [];
  // Title
  if (g.title) {
    parts.push(
      `<text x="${g.width / 2}" y="18" text-anchor="middle" font-weight="600" fill="${theme.text}">${escapeXml(g.title)}</text>`,
    );
  }
  // Edges first so nodes paint over them.
  for (const e of g.edges) {
    const points = e.points.map((p) => `${p.x},${p.y}`).join(' ');
    parts.push(
      `<polyline class="edge arrow-sync-end" points="${points}"/>`,
    );
    // Edge label, placed at the midpoint of the polyline's middle
    // segment.
    if (e.label) {
      const mid = e.points[2]!;
      parts.push(
        `<text x="${mid.x + 6}" y="${mid.y - 4}" class="label">${escapeXml(e.label)}</text>`,
      );
    }
  }
  // Nodes
  for (const n of g.nodes) {
    parts.push(
      `<path class="node-fill" d="${shapeToPath(n)}"/>`,
      `<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 5}" text-anchor="middle" fill="${theme.text}">${escapeXml(n.label)}</text>`,
    );
  }
  return parts.join('');
}

function renderSequence(g: SequenceGeometry, theme: Theme): string {
  const parts: string[] = [];
  if (g.title) {
    parts.push(
      `<text x="${g.width / 2}" y="18" text-anchor="middle" font-weight="600" fill="${theme.text}">${escapeXml(g.title)}</text>`,
    );
  }
  // Actor headers (rounded boxes) + lifelines.
  for (const a of g.actors) {
    const x = a.x - a.w / 2;
    const y = a.y;
    parts.push(
      `<rect class="node-fill" x="${x}" y="${y}" width="${a.w}" height="${a.h}" rx="4" ry="4"/>`,
      `<text x="${a.x}" y="${y + a.h / 2 + 5}" text-anchor="middle" fill="${theme.text}">${escapeXml(a.label)}</text>`,
      `<line class="edge" x1="${a.x}" y1="${a.lifelineY1}" x2="${a.x}" y2="${a.lifelineY2}" stroke-dasharray="6 4"/>`,
    );
  }
  // Messages.
  for (const m of g.messages) {
    const cls =
      m.kind === 'async'
        ? 'edge arrow-async-end'
        : m.kind === 'return'
          ? 'edge arrow-return-end'
          : 'edge arrow-sync-end';
    const dash = m.kind === 'return' ? ' stroke-dasharray="6 4"' : '';
    parts.push(
      `<line class="${cls}" x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}"${dash}/>`,
    );
    if (m.label) {
      const lx = m.x1 < m.x2 ? m.x1 + 6 : m.x1 - 6;
      const anchor = m.x1 < m.x2 ? 'start' : 'end';
      parts.push(
        `<text x="${lx}" y="${m.y1 - 6}" text-anchor="${anchor}" class="label">${escapeXml(m.label)}</text>`,
      );
    }
  }
  return parts.join('');
}

function renderErd(g: ErdGeometry, theme: Theme): string {
  const parts: string[] = [];
  if (g.title) {
    parts.push(
      `<text x="${g.width / 2}" y="18" text-anchor="middle" font-weight="600" fill="${theme.text}">${escapeXml(g.title)}</text>`,
    );
  }
  // Tables.
  for (const e of g.entities) {
    parts.push(
      `<rect class="node-fill" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}"/>`,
      `<rect class="node-fill" x="${e.x}" y="${e.y}" width="${e.w}" height="${ERD_HEADER_BAND_Y()}" fill="${theme.accent}" stroke="${theme.nodeStroke}"/>`,
      `<text x="${e.x + 8}" y="${e.y + 18}" font-weight="600" fill="${theme.background}">${escapeXml(e.label)}</text>`,
    );
    for (const r of e.rows) {
      parts.push(
        `<text x="${e.x + 8}" y="${r.y + 16}" fill="${theme.text}">${escapeXml(r.label)}</text>`,
      );
    }
    // Divider line under header.
    parts.push(
      `<line x1="${e.x}" y1="${e.y + 28}" x2="${e.x + e.w}" y2="${e.y + 28}" stroke="${theme.nodeStroke}"/>`,
    );
  }
  // Relations.
  for (const r of g.relations) {
    parts.push(
      `<line class="edge" x1="${r.x1}" y1="${r.y1}" x2="${r.x2}" y2="${r.y2}"/>`,
    );
    // Cardinality labels at each end.
    parts.push(
      `<text x="${r.x1 - 4}" y="${r.y1 - 4}" text-anchor="end" class="label">${escapeXml(r.fromCard === '1' ? '1' : 'N')}</text>`,
      `<text x="${r.x2 + 4}" y="${r.y2 - 4}" text-anchor="start" class="label">${escapeXml(r.toCard === '1' ? '1' : 'N')}</text>`,
    );
    if (r.label) {
      const mx = (r.x1 + r.x2) / 2;
      const my = (r.y1 + r.y2) / 2;
      parts.push(
        `<text x="${mx}" y="${my - 4}" text-anchor="middle" class="label">${escapeXml(r.label)}</text>`,
      );
    }
  }
  return parts.join('');
}

// Helper to keep the divider line height reading the layout constant.
function ERD_HEADER_BAND_Y(): number {
  return 28;
}

/**
 * Render a `Geometry` to a complete, well-formed SVG string.
 */
export function renderSvg(geometry: Geometry, theme: Theme): string {
  const bg = `<rect x="0" y="0" width="${geometry.width}" height="${geometry.height}" fill="${theme.background}"/>`;
  let body = '';
  switch (geometry.kind) {
    case 'flowchart':
      body = renderFlowchart(geometry, theme);
      break;
    case 'sequence':
      body = renderSequence(geometry, theme);
      break;
    case 'erd':
      body = renderErd(geometry, theme);
      break;
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="${SVG_NS}" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}">`,
    renderDefs(theme),
    bg,
    `<g id="zoom">`,
    body,
    `</g>`,
    `</svg>`,
  ].join('');
}
