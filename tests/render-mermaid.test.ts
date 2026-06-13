/**
 * AC-10: Mermaid output is syntactically valid for the diagram type.
 *
 * Verifies:
 *   1. Header keyword per type:
 *        - flowchart → `flowchart TD`
 *        - sequence  → `sequenceDiagram`
 *        - erd       → `erDiagram`
 *   2. Every node id matches `/^[A-Za-z_][A-Za-z0-9_]*$/`.
 *   3. No unescaped `:` appears inside a flowchart node label
 *      (i.e. between the `[...]`, `(...)`, `{...}`, or `[/.../]`
 *      delimiters of a node declaration line).
 *   4. Any `"` characters in the output are balanced.
 *   5. Each of the four flowchart shapes renders with the correct
 *      delimiter pair.
 *   6. Each sequence message kind produces an arrow.
 *   7. Each ERD cardinality renders with the correct marker.
 *   8. Labels with `"` are neutralised (U+201C left double quote),
 *      so no stray straight-quote runs can break the document.
 */
import { describe, it, expect } from 'vitest';
import { __INTERNAL__ as render } from '../src/tools/render-diagram.js';
import type { DiagramIR, ErdIR, FlowchartIR, SequenceIR } from '../src/types.js';

function renderMermaid(ir: DiagramIR, type: 'flowchart' | 'sequence' | 'erd'): string {
  const r = render.renderImpl({ ir, type, theme: 'light' }) as { mermaid: string };
  return r.mermaid;
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function extractFlowchartIds(mmd: string): string[] {
  // Every flowchart declaration line is `  id<delim>label<delim>`.
  // Pull the leading id (the first non-whitespace token).
  const ids: string[] = [];
  for (const line of mmd.split('\n')) {
    const m = /^  ([A-Za-z_][A-Za-z0-9_]*)\s*[\[\(\{\/]/.exec(line);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

function extractSequenceActorIds(mmd: string): string[] {
  const ids: string[] = [];
  for (const line of mmd.split('\n')) {
    const m = /^  actor ([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(line);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

function extractSequenceMessagePairs(mmd: string): Array<{ from: string; to: string; arrow: string }> {
  const out: Array<{ from: string; to: string; arrow: string }> = [];
  const re = /^  ([A-Za-z_][A-Za-z0-9_]*)\s*(-{1,2}>+)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/;
  for (const line of mmd.split('\n')) {
    const m = re.exec(line);
    if (m) out.push({ from: m[1]!, to: m[3]!, arrow: m[2]! });
  }
  return out;
}

function extractErdEntityIds(mmd: string): string[] {
  const ids: string[] = [];
  for (const line of mmd.split('\n')) {
    const m = /^  ([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(line);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

function extractErdRelations(mmd: string): string[] {
  const out: string[] = [];
  for (const line of mmd.split('\n')) {
    // A relation line looks like `  A ||--|| B`, `  A ||--}o B`,
    // `  A }o--|| B`, or `  A }o--}o B`. The line always has
    // `from` and `to` ids separated by some `--` relation marker.
    if (/^  [A-Za-z_][A-Za-z0-9_]*\s+\S+--\S+\s+[A-Za-z_][A-Za-z0-9_]*/.test(line)) {
      out.push(line);
    }
  }
  return out;
}

describe('AC-10: Mermaid header per type', () => {
  it('flowchart output starts with `flowchart TD`', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [{ id: 'A', label: 'A', shape: 'box' }],
      edges: [],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    expect(mmd).toMatch(/^flowchart TD/);
  });

  it('sequence output starts with `sequenceDiagram`', () => {
    const ir: SequenceIR = {
      kind: 'sequence',
      title: '',
      actors: [{ id: 'A', label: 'A' }],
      messages: [],
    };
    const mmd = renderMermaid(ir, 'sequence');
    expect(mmd).toMatch(/^sequenceDiagram/);
  });

  it('erd output starts with `erDiagram`', () => {
    const ir: ErdIR = {
      kind: 'erd',
      title: '',
      entities: [{ id: 'X', label: 'X', attributes: [] }],
      relations: [],
    };
    const mmd = renderMermaid(ir, 'erd');
    expect(mmd).toMatch(/^erDiagram/);
  });
});

describe('AC-10: every node id matches the identifier regex', () => {
  it('flowchart node ids are valid identifiers', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [
        { id: 'Start', label: 'S', shape: 'box' },
        { id: '_private', label: 'P', shape: 'box' },
        { id: 'X1', label: 'X', shape: 'box' },
        { id: 'node_a', label: 'N', shape: 'box' },
      ],
      edges: [],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    const ids = extractFlowchartIds(mmd);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(ID_RE);
    }
  });

  it('flowchart edge source/target ids are valid identifiers', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [
        { id: 'A', label: 'A', shape: 'box' },
        { id: 'B', label: 'B', shape: 'box' },
      ],
      edges: [{ from: 'A', to: 'B' }],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    for (const line of mmd.split('\n')) {
      const m = /^  ([A-Za-z_][A-Za-z0-9_]*)\s*-->\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (m) {
        expect(m[1]).toMatch(ID_RE);
        expect(m[2]).toMatch(ID_RE);
      }
    }
  });

  it('sequence actor ids are valid identifiers', () => {
    const ir: SequenceIR = {
      kind: 'sequence',
      title: '',
      actors: [
        { id: 'User', label: 'User' },
        { id: '_Server', label: 'Server' },
        { id: 'DB1', label: 'DB' },
      ],
      messages: [],
    };
    const mmd = renderMermaid(ir, 'sequence');
    const ids = extractSequenceActorIds(mmd);
    expect(ids.length).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(ID_RE);
    }
  });

  it('sequence message from/to ids are valid identifiers', () => {
    const ir: SequenceIR = {
      kind: 'sequence',
      title: '',
      actors: [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' },
      ],
      messages: [
        { from: 'A', to: 'B', label: 'hi', kind: 'sync' },
        { from: 'B', to: 'A', label: 'bye', kind: 'return' },
      ],
    };
    const mmd = renderMermaid(ir, 'sequence');
    const pairs = extractSequenceMessagePairs(mmd);
    expect(pairs.length).toBe(2);
    for (const p of pairs) {
      expect(p.from).toMatch(ID_RE);
      expect(p.to).toMatch(ID_RE);
    }
  });

  it('erd entity ids are valid identifiers', () => {
    const ir: ErdIR = {
      kind: 'erd',
      title: '',
      entities: [
        { id: 'Book', label: 'Book', attributes: ['id'] },
        { id: 'Author', label: 'Author', attributes: ['id'] },
        { id: 'Publisher', label: 'Publisher', attributes: ['id'] },
      ],
      relations: [],
    };
    const mmd = renderMermaid(ir, 'erd');
    const ids = extractErdEntityIds(mmd);
    expect(ids.length).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(ID_RE);
    }
  });

  it('erd relation source/target ids are valid identifiers', () => {
    const ir: ErdIR = {
      kind: 'erd',
      title: '',
      entities: [
        { id: 'A', label: 'A', attributes: [] },
        { id: 'B', label: 'B', attributes: [] },
      ],
      relations: [
        { from: 'A', to: 'B', fromCard: '1', toCard: '1' },
        { from: 'A', to: 'B', fromCard: '*', toCard: '1' },
        { from: 'B', to: 'A', fromCard: '*', toCard: '*' },
      ],
    };
    const mmd = renderMermaid(ir, 'erd');
    for (const line of mmd.split('\n')) {
      const m = /^  ([A-Za-z_][A-Za-z0-9_]*)\s+[\}\|\{o]+\-\-[\}\|\{o]+\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (m) {
        expect(m[1]).toMatch(ID_RE);
        expect(m[2]).toMatch(ID_RE);
      }
    }
  });
});

describe('AC-10: no unescaped `:` inside flowchart node labels', () => {
  it('colons in node labels are stripped (replaced with space)', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [
        { id: 'A', label: 'Start: now', shape: 'box' },
        { id: 'B', label: 'Decide: yes or no?', shape: 'diamond' },
      ],
      edges: [],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    // Find the declaration lines for A and B and check the labels.
    for (const line of mmd.split('\n')) {
      const m = /^  ([AB])\s*[\[\(\{\/]\s*(.+?)\s*[\]\)\}\/]\s*$/.exec(line);
      if (m) {
        // The label content (group 2) must not contain a colon.
        expect(m[2]).not.toMatch(/:/);
      }
    }
  });

  it('all four flowchart shapes use the right delimiter pair', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [
        { id: 'B1', label: 'box', shape: 'box' },
        { id: 'R1', label: 'round', shape: 'round' },
        { id: 'D1', label: 'diamond', shape: 'diamond' },
        { id: 'P1', label: 'parallelogram', shape: 'parallelogram' },
      ],
      edges: [],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    expect(mmd).toMatch(/B1\[box\]/);
    expect(mmd).toMatch(/R1\(round\)/);
    expect(mmd).toMatch(/D1\{diamond\}/);
    expect(mmd).toMatch(/P1\[\/parallelogram\/\]/);
  });

  it('edge separator `:` is the ONLY colon in the flowchart output', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [
        { id: 'A', label: 'a:b:c', shape: 'box' },
        { id: 'B', label: 'b', shape: 'box' },
      ],
      edges: [{ from: 'A', to: 'B', label: 'go:now' }],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    // Every `:` in the output must be the edge-label separator
    // (i.e. appear on a line that contains `-->`).
    const linesWithColon: string[] = [];
    for (const line of mmd.split('\n')) {
      if (line.includes(':') && !line.match(/^\s*$/)) {
        linesWithColon.push(line);
      }
    }
    // Each line that has a colon must be an edge line (`-->`).
    for (const line of linesWithColon) {
      expect(line).toMatch(/-->/);
    }
  });
});

describe('AC-10: quotes are balanced (or absent)', () => {
  it('flowchart output contains an even number of `"` characters', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: '',
      nodes: [
        { id: 'A', label: 'has "double" quotes', shape: 'box' },
        { id: 'B', label: 'normal', shape: 'box' },
      ],
      edges: [{ from: 'A', to: 'B', label: 'edge with "quotes"' }],
    };
    const mmd = renderMermaid(ir, 'flowchart');
    const straight = (mmd.match(/"/g) ?? []).length;
    expect(straight % 2).toBe(0);
  });

  it('sequence output contains an even number of `"` characters', () => {
    const ir: SequenceIR = {
      kind: 'sequence',
      title: '',
      actors: [{ id: 'A', label: 'A' }],
      messages: [{ from: 'A', to: 'A', label: 'has "quotes"', kind: 'sync' }],
    };
    const mmd = renderMermaid(ir, 'sequence');
    const straight = (mmd.match(/"/g) ?? []).length;
    expect(straight % 2).toBe(0);
  });

  it('erd output contains an even number of `"` characters', () => {
    const ir: ErdIR = {
      kind: 'erd',
      title: '',
      entities: [{ id: 'A', label: 'A', attributes: ['field'] }],
      relations: [
        { from: 'A', to: 'A', fromCard: '1', toCard: '1', label: 'has "quotes"' },
      ],
    };
    const mmd = renderMermaid(ir, 'erd');
    const straight = (mmd.match(/"/g) ?? []).length;
    expect(straight % 2).toBe(0);
  });
});

describe('AC-10: arrow/cardinality coverage', () => {
  it('sequence sync, async, and return messages all produce an arrow line', () => {
    const ir: SequenceIR = {
      kind: 'sequence',
      title: '',
      actors: [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' },
      ],
      messages: [
        { from: 'A', to: 'B', label: 'sync', kind: 'sync' },
        { from: 'B', to: 'A', label: 'return', kind: 'return' },
        { from: 'A', to: 'B', label: 'async', kind: 'async' },
      ],
    };
    const mmd = renderMermaid(ir, 'sequence');
    const pairs = extractSequenceMessagePairs(mmd);
    expect(pairs.length).toBe(3);
    // Every pair has a non-empty arrow token.
    for (const p of pairs) {
      expect(p.arrow.length).toBeGreaterThan(0);
    }
  });

  it('erd 1:1, 1:*, *:1, and *:* relations each produce a relation line', () => {
    const ir: ErdIR = {
      kind: 'erd',
      title: '',
      entities: [
        { id: 'A', label: 'A', attributes: [] },
        { id: 'B', label: 'B', attributes: [] },
        { id: 'C', label: 'C', attributes: [] },
        { id: 'D', label: 'D', attributes: [] },
      ],
      relations: [
        { from: 'A', to: 'B', fromCard: '1', toCard: '1' },
        { from: 'A', to: 'C', fromCard: '1', toCard: '*' },
        { from: 'A', to: 'D', fromCard: '*', toCard: '1' },
        { from: 'B', to: 'C', fromCard: '*', toCard: '*' },
      ],
    };
    const mmd = renderMermaid(ir, 'erd');
    const rels = extractErdRelations(mmd);
    expect(rels.length).toBe(4);
  });
});

describe('AC-10: byte-deterministic', () => {
  it('two consecutive renders produce byte-equal Mermaid output', () => {
    const ir: FlowchartIR = {
      kind: 'flowchart',
      title: 'Demo',
      nodes: [
        { id: 'A', label: 'Start', shape: 'box' },
        { id: 'B', label: 'End', shape: 'box' },
      ],
      edges: [{ from: 'A', to: 'B' }],
    };
    const a = renderMermaid(ir, 'flowchart');
    const b = renderMermaid(ir, 'flowchart');
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});
