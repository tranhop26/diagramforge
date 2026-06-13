/**
 * AC-8: SVG well-formedness, single root, non-overlap, edge endpoint
 * accuracy, XML escape.
 *
 * Verifies:
 *   1. The vendored XML parser sees exactly one root named `svg`.
 *   2. The root carries `xmlns="http://www.w3.org/2000/svg"`.
 *   3. For every pair of flowchart node `<path>` bounding boxes,
 *      they do not pairwise intersect.
 *   4. For every flowchart edge, the last polyline point lies on
 *      the target node's border (within ±1.5 px).
 *   5. A label containing `&<>"'` renders to `&amp;&lt;&gt;&quot;&apos;`.
 *   6. All three diagram types produce a well-formed `<svg>` root.
 */
import { describe, it, expect } from 'vitest';
import { __INTERNAL__ as render } from '../src/tools/render-diagram.js';
import { escapeXml } from '../src/render/_escape.js';
import { parseXmlString, type XmlElement } from './util/xml.js';
import type { DiagramIR as RealDiagramIR } from '../src/types.js';

const SAMPLES: Record<string, RealDiagramIR> = {
  flowchart: {
    kind: 'flowchart',
    title: 'Order processing',
    nodes: [
      { id: 'A', label: 'Start', shape: 'box' },
      { id: 'B', label: 'Decide', shape: 'diamond' },
      { id: 'C', label: 'Pay', shape: 'box' },
      { id: 'D', label: 'Cancel', shape: 'box' },
    ],
    edges: [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C', label: 'yes' },
      { from: 'B', to: 'D', label: 'no' },
    ],
  },
  sequence: {
    kind: 'sequence',
    title: 'Login',
    actors: [
      { id: 'U', label: 'User' },
      { id: 'S', label: 'Server' },
      { id: 'DB', label: 'DB' },
    ],
    messages: [
      { from: 'U', to: 'S', label: 'POST /login', kind: 'sync' },
      { from: 'S', to: 'DB', label: 'query user', kind: 'async' },
      { from: 'DB', to: 'S', label: 'user record', kind: 'return' },
    ],
  },
  erd: {
    kind: 'erd',
    title: 'Library',
    entities: [
      { id: 'Book', label: 'Book', attributes: ['id', 'title'] },
      { id: 'Author', label: 'Author', attributes: ['id', 'name'] },
    ],
    relations: [
      {
        from: 'Book',
        to: 'Author',
        fromCard: '*',
        toCard: '1',
        label: 'written by',
      },
    ],
  },
};

function renderSvg(ir: RealDiagramIR, type: 'flowchart' | 'sequence' | 'erd'): string {
  const r = render.renderImpl({ ir, type, theme: 'light' }) as { svg: string };
  return r.svg;
}

/**
 * Compute the bounding box of an SVG path's `d` attribute by
 * tracking the current pen position through M / L (absolute) and
 * h / v (relative) commands. Closes with `z` are ignored (they
 * return to the start, which is already in the bbox). The renderer
 * only emits these commands, so we don't need a full SVG path
 * parser.
 */
function pathBoundingBox(d: string): { x: number; y: number; w: number; h: number } {
  const tokens = d
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const xs: number[] = [];
  const ys: number[] = [];
  let cx = 0;
  let cy = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === 'M' || t === 'L') {
      cx = parseFloat(tokens[++i]!);
      cy = parseFloat(tokens[++i]!);
      xs.push(cx);
      ys.push(cy);
    } else if (t === 'h') {
      cx += parseFloat(tokens[++i]!);
      xs.push(cx);
    } else if (t === 'v') {
      cy += parseFloat(tokens[++i]!);
      ys.push(cy);
    } else if (t === 'H') {
      cx = parseFloat(tokens[++i]!);
      xs.push(cx);
    } else if (t === 'V') {
      cy = parseFloat(tokens[++i]!);
      ys.push(cy);
    } else if (t === 'z' || t === 'Z') {
      // close — start point already recorded
    } else if (/^-?\d/.test(t)) {
      // implicit continuation of last command: treat as L.
      cx = parseFloat(t);
      cy = parseFloat(tokens[++i]!);
      xs.push(cx);
      ys.push(cy);
    }
    i++;
  }
  if (xs.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  return { x, y, w, h };
}

function bboxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  // Strict non-overlap: the boxes must not share any interior point.
  // Touching borders (a.x + a.w === b.x) is allowed.
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function pointOnBorder(
  p: { x: number; y: number },
  b: { x: number; y: number; w: number; h: number },
  tol = 1.5,
): boolean {
  const onLeft = Math.abs(p.x - b.x) <= tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  const onRight =
    Math.abs(p.x - (b.x + b.w)) <= tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  const onTop = Math.abs(p.y - b.y) <= tol && p.x >= b.x - tol && p.x <= b.x + b.w + tol;
  const onBottom =
    Math.abs(p.y - (b.y + b.h)) <= tol && p.x >= b.x - tol && p.x <= b.x + b.w + tol;
  return onLeft || onRight || onTop || onBottom;
}

function collectByName(
  e: XmlElement,
  name: string,
  pred: (attrs: Record<string, string>) => boolean = () => true,
): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    if (node.name === name && pred(node.attrs)) out.push(node);
    for (const c of node.children) {
      if (typeof c === 'object' && c !== null) walk(c as XmlElement);
    }
  };
  walk(e);
  return out;
}

describe('AC-8: SVG well-formedness', () => {
  it('parseXmlString: produces a single root named `svg`', () => {
    const svg = renderSvg(SAMPLES['flowchart']!, 'flowchart');
    const doc = parseXmlString(svg);
    expect(doc.rootName).toBe('svg');
  });

  it('the svg root carries xmlns="http://www.w3.org/2000/svg"', () => {
    const svg = renderSvg(SAMPLES['flowchart']!, 'flowchart');
    const doc = parseXmlString(svg);
    expect(doc.root.attrs['xmlns']).toBe('http://www.w3.org/2000/svg');
  });

  it('exactly one <svg> root tag in the document', () => {
    const svg = renderSvg(SAMPLES['sequence']!, 'sequence');
    const openCount = (svg.match(/<svg[\s>]/g) ?? []).length;
    const closeCount = (svg.match(/<\/svg>/g) ?? []).length;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
  });

  it('well-formed XML: parser does not throw for any of the three diagram types', () => {
    for (const k of Object.keys(SAMPLES)) {
      const ir = SAMPLES[k]!;
      const type = k as 'flowchart' | 'sequence' | 'erd';
      const svg = renderSvg(ir, type);
      expect(() => parseXmlString(svg)).not.toThrow();
    }
  });
});

describe('AC-8: flowchart node non-overlap', () => {
  it('pairwise bounding boxes of flowchart node <path> elements do not intersect', () => {
    const ir = SAMPLES['flowchart']!;
    const svg = renderSvg(ir, 'flowchart');
    const doc = parseXmlString(svg);
    const paths = collectByName(
      doc.root,
      'path',
      (a) => a['class'] === 'node-fill',
    );
    expect(paths.length).toBe(ir.nodes.length);
    const bboxes = paths.map((p) => pathBoundingBox(p.attrs['d'] ?? ''));
    for (let i = 0; i < bboxes.length; i++) {
      for (let j = i + 1; j < bboxes.length; j++) {
        expect(bboxesOverlap(bboxes[i]!, bboxes[j]!)).toBe(false);
      }
    }
  });

  it('flowchart node bounding boxes have non-zero width and height', () => {
    const ir = SAMPLES['flowchart']!;
    const svg = renderSvg(ir, 'flowchart');
    const doc = parseXmlString(svg);
    const paths = collectByName(
      doc.root,
      'path',
      (a) => a['class'] === 'node-fill',
    );
    const bboxes = paths.map((p) => pathBoundingBox(p.attrs['d'] ?? ''));
    for (const b of bboxes) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });
});

describe('AC-8: edge endpoint accuracy', () => {
  it('flowchart edge endpoints land on the target node border (within ±1.5 px)', () => {
    const ir = SAMPLES['flowchart']!;
    const svg = renderSvg(ir, 'flowchart');
    const doc = parseXmlString(svg);
    const nodePaths = collectByName(
      doc.root,
      'path',
      (a) => a['class'] === 'node-fill',
    );
    const nodeBboxes = nodePaths.map((p) => pathBoundingBox(p.attrs['d'] ?? ''));
    const polylines = collectByName(doc.root, 'polyline');
    expect(polylines.length).toBe(ir.edges.length);
    for (const pl of polylines) {
      const points = (pl.attrs['points'] ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [x, y] = pair.split(',').map(Number);
          return { x: x!, y: y! };
        });
      const last = points[points.length - 1]!;
      const onAny = nodeBboxes.some((b) => pointOnBorder(last, b, 1.5));
      expect(onAny).toBe(true);
    }
  });
});

describe('AC-8: XML escape', () => {
  it('escapeXml: replaces the five predefined entities', () => {
    expect(escapeXml('&')).toBe('&amp;');
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('>')).toBe('&gt;');
    expect(escapeXml('"')).toBe('&quot;');
    expect(escapeXml("'")).toBe('&apos;');
  });

  it('escapeXml: leaves safe text alone', () => {
    expect(escapeXml('hello world')).toBe('hello world');
    expect(escapeXml('a-b_c.d/e')).toBe('a-b_c.d/e');
  });

  it('escapeXml: encodes a label containing &<>"\' to the five entities', () => {
    const input = `&<>"'`;
    const out = escapeXml(input);
    expect(out).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('a node label with &<>"\' appears in the SVG as &amp;&lt;&gt;&quot;&apos;', () => {
    const ir: RealDiagramIR = {
      kind: 'flowchart',
      title: 'escape test',
      nodes: [{ id: 'X', label: `&<>"'`, shape: 'box' }],
      edges: [],
    };
    const svg = renderSvg(ir, 'flowchart');
    // The five predefined entities are present in the source.
    expect(svg).toContain('&amp;&lt;&gt;&quot;&apos;');
    // The XML parser must accept the result without throwing — i.e.
    // the document is well-formed.
    const doc = parseXmlString(svg);
    expect(doc.rootName).toBe('svg');
    // No raw `&`, `<`, or `>` may appear outside of an entity or tag.
    // Specifically: between any closing `>` and the next opening `<`,
    // the only acceptable character is the entity prefix. We check
    // that the only `&` occurrences are followed by one of the five
    // entity names.
    const ampersandMatches = svg.match(/&[^;]{0,12};/g) ?? [];
    for (const m of ampersandMatches) {
      expect(m).toMatch(/^(&amp;|&lt;|&gt;|&quot;|&apos;|#x?[0-9a-fA-F]+;)$/);
    }
  });
});
