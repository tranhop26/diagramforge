/**
 * AC-11: `make_diagram(text, type?, theme?)` orchestrates
 * `parse_spec` then `render_diagram` and returns
 * `{ svg, mermaid, html, manifest, summary }` with
 * `manifest = { type, theme, nodeCount, edgeCount }` and
 * `summary` a single human-readable line.
 *
 * Test groups:
 *   1. Result shape and types — every field exists with the right type.
 *   2. Manifest shape and counts — nodeCount/edgeCount mirror the IR
 *      for all three diagram kinds.
 *   3. Summary format — one line, type-prefixed, kind-appropriate
 *      noun, theme suffix, unknown-theme marker.
 *   4. Orchestration equivalence — `make_diagram` produces svg/mermaid/html
 *      byte-identical to `render_diagram(parse_spec(text, type).ir, ...)`.
 *   5. Optional `type` and `theme` parameters.
 *   6. Unknown theme fallback — manifest.theme is `light`; summary has
 *      the `[theme: unknown → light]` marker.
 *   7. Determinism — two consecutive calls produce byte-equal output.
 *   8. End-to-end via stdio MCP server.
 *   9. Input validation — bad input surfaces as a `{ok:false,error}`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioClient } from './_helpers.js';
import { __INTERNAL__ as make } from '../src/tools/make-diagram.js';
import { __INTERNAL__ as render } from '../src/tools/render-diagram.js';
import { parseProse } from '../src/parsers/prose.js';
import type {
  DiagramType,
  ErdIR,
  FlowchartIR,
  Manifest,
  MakeDiagramResult,
  SequenceIR,
  ToolOutput,
} from '../src/types.js';

const FLOW_TEXT =
  'flowchart: Order processing\n' +
  'A: Start\n' +
  'B: Decide\n' +
  'C: Pay\n' +
  'A -> B\n' +
  'B -> C: yes';
// 3 nodes (A,B,C), 2 edges (A->B, B->C:yes).

const SEQ_TEXT =
  'sequence: Login\n' +
  'actor U: User\n' +
  'actor S: Server\n' +
  'actor DB: Database\n' +
  'U -> S: POST /login\n' +
  'S ->> DB: query user\n' +
  'DB --> S: user record';
// 3 actors (U, S, DB), 3 messages.

const ERD_TEXT =
  'erd: Library\n' +
  'entity Book { id, title }\n' +
  'entity Author: Person name\n' +
  'entity Publisher: Press name\n' +
  'Book ||--o{ Author: written by\n' +
  'Book ||--o{ Publisher: published by';
// 3 entities, 2 relations.

// ---------------------------------------------------------------------------
// 1. Result shape
// ---------------------------------------------------------------------------

describe('AC-11: result shape (in-process)', () => {
  it('returns { svg, mermaid, html, manifest, summary } for a flowchart', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(typeof r.svg).toBe('string');
    expect(typeof r.mermaid).toBe('string');
    expect(typeof r.html).toBe('string');
    expect(r.manifest).toBeDefined();
    expect(typeof r.summary).toBe('string');
  });

  it('returns { svg, mermaid, html, manifest, summary } for a sequence', async () => {
    const r = await make.makeImpl({ text: SEQ_TEXT });
    expect(typeof r.svg).toBe('string');
    expect(typeof r.mermaid).toBe('string');
    expect(typeof r.html).toBe('string');
    expect(r.manifest).toBeDefined();
    expect(typeof r.summary).toBe('string');
  });

  it('returns { svg, mermaid, html, manifest, summary } for an ERD', async () => {
    const r = await make.makeImpl({ text: ERD_TEXT });
    expect(typeof r.svg).toBe('string');
    expect(typeof r.mermaid).toBe('string');
    expect(typeof r.html).toBe('string');
    expect(r.manifest).toBeDefined();
    expect(typeof r.summary).toBe('string');
  });

  it('manifest contains exactly { type, theme, nodeCount, edgeCount }', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    const keys = Object.keys(r.manifest).sort();
    expect(keys).toEqual(['edgeCount', 'nodeCount', 'theme', 'type']);
  });

  it('manifest field types are correct', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(typeof r.manifest.type).toBe('string');
    expect(typeof r.manifest.theme).toBe('string');
    expect(typeof r.manifest.nodeCount).toBe('number');
    expect(typeof r.manifest.edgeCount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 2. Manifest counts match the IR
// ---------------------------------------------------------------------------

describe('AC-11: manifest counts match the IR', () => {
  it('flowchart: nodeCount = ir.nodes.length, edgeCount = ir.edges.length', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    const { ir } = await parseProse(FLOW_TEXT);
    expect(ir.kind).toBe('flowchart');
    const fir = ir as FlowchartIR;
    expect(r.manifest.type).toBe('flowchart');
    expect(r.manifest.nodeCount).toBe(fir.nodes.length);
    expect(r.manifest.edgeCount).toBe(fir.edges.length);
  });

  it('sequence: nodeCount = ir.actors.length, edgeCount = ir.messages.length', async () => {
    const r = await make.makeImpl({ text: SEQ_TEXT });
    const { ir } = await parseProse(SEQ_TEXT);
    expect(ir.kind).toBe('sequence');
    const sir = ir as SequenceIR;
    expect(r.manifest.type).toBe('sequence');
    expect(r.manifest.nodeCount).toBe(sir.actors.length);
    expect(r.manifest.edgeCount).toBe(sir.messages.length);
  });

  it('erd: nodeCount = ir.entities.length, edgeCount = ir.relations.length', async () => {
    const r = await make.makeImpl({ text: ERD_TEXT });
    const { ir } = await parseProse(ERD_TEXT);
    expect(ir.kind).toBe('erd');
    const eir = ir as ErdIR;
    expect(r.manifest.type).toBe('erd');
    expect(r.manifest.nodeCount).toBe(eir.entities.length);
    expect(r.manifest.edgeCount).toBe(eir.relations.length);
  });

  it('flowchart sample manifests: 3 nodes / 2 edges', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(r.manifest.nodeCount).toBe(3);
    expect(r.manifest.edgeCount).toBe(2);
  });

  it('sequence sample manifests: 3 actors / 3 messages', async () => {
    const r = await make.makeImpl({ text: SEQ_TEXT });
    expect(r.manifest.nodeCount).toBe(3);
    expect(r.manifest.edgeCount).toBe(3);
  });

  it('erd sample manifests: 3 entities / 2 relations', async () => {
    const r = await make.makeImpl({ text: ERD_TEXT });
    expect(r.manifest.nodeCount).toBe(3);
    expect(r.manifest.edgeCount).toBe(2);
  });

  it('empty IR produces 0/0 in the manifest', async () => {
    const r = await make.makeImpl({ text: 'flowchart: Empty' });
    expect(r.manifest.nodeCount).toBe(0);
    expect(r.manifest.edgeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Summary format
// ---------------------------------------------------------------------------

describe('AC-11: summary is a single human-readable line', () => {
  it('contains no newline characters (single line)', async () => {
    for (const text of [FLOW_TEXT, SEQ_TEXT, ERD_TEXT]) {
      const r = await make.makeImpl({ text });
      expect(r.summary).not.toMatch(/\n/);
      expect(r.summary).not.toMatch(/\r/);
    }
  });

  it('flowchart summary uses the exact example format: <type>: <title> — <N> nodes, <M> edges, theme=<theme>', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    // Format: flowchart: Order processing — 3 nodes, 2 edges, theme=light
    expect(r.summary).toBe('flowchart: Order processing — 3 nodes, 2 edges, theme=light');
  });

  it('sequence summary uses the kind-appropriate noun: actors/messages', async () => {
    const r = await make.makeImpl({ text: SEQ_TEXT });
    expect(r.summary).toBe('sequence: Login — 3 actors, 3 messages, theme=light');
  });

  it('erd summary uses the kind-appropriate noun: entities/relations', async () => {
    const r = await make.makeImpl({ text: ERD_TEXT });
    expect(r.summary).toBe('erd: Library — 3 entities, 2 relations, theme=light');
  });

  it('summary starts with the diagram type', async () => {
    const r1 = await make.makeImpl({ text: FLOW_TEXT });
    const r2 = await make.makeImpl({ text: SEQ_TEXT });
    const r3 = await make.makeImpl({ text: ERD_TEXT });
    expect(r1.summary.startsWith('flowchart: ')).toBe(true);
    expect(r2.summary.startsWith('sequence: ')).toBe(true);
    expect(r3.summary.startsWith('erd: ')).toBe(true);
  });

  it('summary contains the manifest.theme', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, theme: 'dark' });
    expect(r.summary).toContain('theme=dark');
  });

  it('summary contains the manifest.nodeCount and manifest.edgeCount', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(r.summary).toContain(String(r.manifest.nodeCount));
    expect(r.summary).toContain(String(r.manifest.edgeCount));
  });
});

// ---------------------------------------------------------------------------
// 4. Orchestration equivalence with parse_spec + render_diagram
// ---------------------------------------------------------------------------

describe('AC-11: orchestration equivalence (parse_spec → render_diagram)', () => {
  it('flowchart: make_diagram === render_diagram(parse_spec(text, type))', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, type: 'flowchart', theme: 'dark' });
    const { ir } = await parseProse(FLOW_TEXT, 'flowchart');
    const r2 = render.renderImpl({ ir, type: 'flowchart', theme: 'dark' });
    expect(r.svg).toBe((r2 as { svg: string }).svg);
    expect(r.mermaid).toBe((r2 as { mermaid: string }).mermaid);
    expect(r.html).toBe((r2 as { html: string }).html);
  });

  it('sequence: make_diagram === render_diagram(parse_spec(text, type))', async () => {
    const r = await make.makeImpl({ text: SEQ_TEXT, type: 'sequence', theme: 'blueprint' });
    const { ir } = await parseProse(SEQ_TEXT, 'sequence');
    const r2 = render.renderImpl({ ir, type: 'sequence', theme: 'blueprint' });
    expect(r.svg).toBe((r2 as { svg: string }).svg);
    expect(r.mermaid).toBe((r2 as { mermaid: string }).mermaid);
    expect(r.html).toBe((r2 as { html: string }).html);
  });

  it('erd: make_diagram === render_diagram(parse_spec(text, type))', async () => {
    const r = await make.makeImpl({ text: ERD_TEXT, type: 'erd', theme: 'light' });
    const { ir } = await parseProse(ERD_TEXT, 'erd');
    const r2 = render.renderImpl({ ir, type: 'erd', theme: 'light' });
    expect(r.svg).toBe((r2 as { svg: string }).svg);
    expect(r.mermaid).toBe((r2 as { mermaid: string }).mermaid);
    expect(r.html).toBe((r2 as { html: string }).html);
  });
});

// ---------------------------------------------------------------------------
// 5. Optional type and theme parameters
// ---------------------------------------------------------------------------

describe('AC-11: optional type and theme parameters', () => {
  it('omitting `type` falls back to the DSL prefix kind', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(r.manifest.type).toBe('flowchart');
  });

  it('omitting `theme` defaults to light', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(r.manifest.theme).toBe('light');
  });

  it('explicit `type` overrides the parsed kind', async () => {
    // Text has `flowchart:` prefix, but we pass type: 'erd' — the IR
    // kind is still flowchart, but the manifest.type follows the
    // explicit `type` argument (used for the summary header).
    const r = await make.makeImpl({ text: FLOW_TEXT, type: 'erd' });
    expect(r.manifest.type).toBe('erd');
    expect(r.summary.startsWith('erd: ')).toBe(true);
  });

  it('explicit `theme: dark` is reflected in manifest and summary', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, theme: 'dark' });
    expect(r.manifest.theme).toBe('dark');
    expect(r.summary).toContain('theme=dark');
  });

  it('explicit `theme: blueprint` is reflected in manifest and summary', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, theme: 'blueprint' });
    expect(r.manifest.theme).toBe('blueprint');
    expect(r.summary).toContain('theme=blueprint');
  });

  it('all three shipped themes round-trip through make_diagram', async () => {
    for (const theme of ['light', 'dark', 'blueprint'] as const) {
      const r = await make.makeImpl({ text: FLOW_TEXT, theme });
      expect(r.manifest.theme).toBe(theme);
      expect(r.svg.length).toBeGreaterThan(0);
      expect(r.mermaid.length).toBeGreaterThan(0);
      expect(r.html.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Unknown theme fallback
// ---------------------------------------------------------------------------

describe('AC-11: unknown theme fallback', () => {
  it('manifest.theme is "light" when theme is unknown', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, theme: 'neon' });
    expect(r.manifest.theme).toBe('light');
  });

  it('summary string includes [theme: <unknown> → light] marker', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, theme: 'neon' });
    expect(r.summary).toMatch(/\[theme: neon → light\]/);
  });

  it('fallback is silent on the summary when theme is shipped', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT, theme: 'dark' });
    expect(r.summary).not.toMatch(/\[theme:/);
  });

  it('multiple unknown themes all surface in their own summary line', async () => {
    for (const bad of ['neon', 'cobalt', 'solarized', 'X']) {
      const r = await make.makeImpl({ text: FLOW_TEXT, theme: bad });
      expect(r.manifest.theme).toBe('light');
      expect(r.summary).toMatch(new RegExp(`\\[theme: ${bad} → light\\]`));
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Determinism
// ---------------------------------------------------------------------------

describe('AC-11: determinism', () => {
  it('two consecutive make_diagram calls return byte-equal svg', async () => {
    const a = await make.makeImpl({ text: FLOW_TEXT, theme: 'light' });
    const b = await make.makeImpl({ text: FLOW_TEXT, theme: 'light' });
    expect(Buffer.compare(Buffer.from(a.svg), Buffer.from(b.svg))).toBe(0);
  });

  it('two consecutive make_diagram calls return byte-equal mermaid', async () => {
    const a = await make.makeImpl({ text: SEQ_TEXT, theme: 'dark' });
    const b = await make.makeImpl({ text: SEQ_TEXT, theme: 'dark' });
    expect(Buffer.compare(Buffer.from(a.mermaid), Buffer.from(b.mermaid))).toBe(0);
  });

  it('two consecutive make_diagram calls return byte-equal html', async () => {
    const a = await make.makeImpl({ text: ERD_TEXT, theme: 'blueprint' });
    const b = await make.makeImpl({ text: ERD_TEXT, theme: 'blueprint' });
    expect(Buffer.compare(Buffer.from(a.html), Buffer.from(b.html))).toBe(0);
  });

  it('two consecutive make_diagram calls return byte-equal summary', async () => {
    const a = await make.makeImpl({ text: FLOW_TEXT });
    const b = await make.makeImpl({ text: FLOW_TEXT });
    expect(a.summary).toBe(b.summary);
  });
});

// ---------------------------------------------------------------------------
// 8. End-to-end via stdio MCP server
// ---------------------------------------------------------------------------

describe('AC-11: stdio round-trip', () => {
  let client: StdioClient | null = null;
  beforeAll(async () => {
    client = new StdioClient();
    await client.initialize();
  }, 15_000);
  afterAll(async () => {
    if (client) await client.close();
  });

  it('stdios: flowchart make_diagram returns ok=true with the full result shape', async () => {
    if (!client) throw new Error('client not initialized');
    const r = await client.callTool<MakeDiagramResult>('make_diagram', { text: FLOW_TEXT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.svg).toBe('string');
    expect(typeof r.value.mermaid).toBe('string');
    expect(typeof r.value.html).toBe('string');
    expect(typeof r.value.summary).toBe('string');
    expect(r.value.manifest.type).toBe('flowchart');
    expect(r.value.manifest.nodeCount).toBe(3);
    expect(r.value.manifest.edgeCount).toBe(2);
    expect(r.value.summary).toBe('flowchart: Order processing — 3 nodes, 2 edges, theme=light');
  });

  it('stdios: sequence make_diagram returns the kind-appropriate summary', async () => {
    if (!client) throw new Error('client not initialized');
    const r = await client.callTool<MakeDiagramResult>('make_diagram', { text: SEQ_TEXT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.type).toBe('sequence');
    expect(r.value.summary).toContain('actors');
    expect(r.value.summary).toContain('messages');
  });

  it('stdios: erd make_diagram returns the kind-appropriate summary', async () => {
    if (!client) throw new Error('client not initialized');
    const r = await client.callTool<MakeDiagramResult>('make_diagram', { text: ERD_TEXT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.type).toBe('erd');
    expect(r.value.summary).toContain('entities');
    expect(r.value.summary).toContain('relations');
  });

  it('stdios: unknown theme falls back to light in manifest + marker in summary', async () => {
    if (!client) throw new Error('client not initialized');
    const r = await client.callTool<MakeDiagramResult>('make_diagram', {
      text: FLOW_TEXT,
      theme: 'neon',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.theme).toBe('light');
    expect(r.value.summary).toMatch(/\[theme: neon → light\]/);
  });
});

// ---------------------------------------------------------------------------
// 9. Input validation
// ---------------------------------------------------------------------------

describe('AC-11: input validation', () => {
  it('missing `text` throws a zod error', async () => {
    await expect(make.makeImpl({})).rejects.toThrow(/text/);
  });

  it('empty `text` throws a zod error', async () => {
    await expect(make.makeImpl({ text: '' })).rejects.toThrow(/text/);
  });

  it('wrong `type` enum throws a zod error', async () => {
    await expect(
      make.makeImpl({ text: FLOW_TEXT, type: 'mindmap' as DiagramType }),
    ).rejects.toThrow(/type/);
  });

  it('non-string `text` throws a zod error', async () => {
    await expect(make.makeImpl({ text: 42 as unknown as string })).rejects.toThrow(/text/);
  });
});

// ---------------------------------------------------------------------------
// Manifest contract — exhaustive property check
// ---------------------------------------------------------------------------

describe('AC-11: manifest contract', () => {
  it('manifest.type is always a valid DiagramType literal', async () => {
    for (const text of [FLOW_TEXT, SEQ_TEXT, ERD_TEXT]) {
      const r = await make.makeImpl({ text });
      expect(['flowchart', 'sequence', 'erd']).toContain(r.manifest.type);
    }
  });

  it('manifest.theme is always a valid ThemeName literal', async () => {
    for (const text of [FLOW_TEXT, SEQ_TEXT, ERD_TEXT]) {
      const r = await make.makeImpl({ text });
      expect(['light', 'dark', 'blueprint']).toContain(r.manifest.theme);
    }
  });

  it('nodeCount is a non-negative integer', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(Number.isInteger(r.manifest.nodeCount)).toBe(true);
    expect(r.manifest.nodeCount).toBeGreaterThanOrEqual(0);
  });

  it('edgeCount is a non-negative integer', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(Number.isInteger(r.manifest.edgeCount)).toBe(true);
    expect(r.manifest.edgeCount).toBeGreaterThanOrEqual(0);
  });

  it('manifest is structurally a plain object (not a class instance)', async () => {
    const r = await make.makeImpl({ text: FLOW_TEXT });
    expect(Object.getPrototypeOf(r.manifest)).toBe(Object.prototype);
  });
});
