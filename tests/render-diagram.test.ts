/**
 * AC-7: `render_diagram` is a pure function of (ir, type, theme).
 *
 *   1. Two consecutive calls with the same input produce byte-equal
 *      `svg` (Buffer.compare(a, b) === 0).
 *   2. Ten consecutive calls all produce byte-equal `svg`.
 *   3. Different themes produce different `svg` (sanity).
 *   4. Unknown theme falls back to `light`, emits one stderr line,
 *      and the make_diagram summary string includes the
 *      `[theme: unknown → light]` marker.
 *   5. All three diagram types round-trip through the handler.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioClient } from './_helpers.js';
import type { ToolOutput } from '../src/types.js';
import { __INTERNAL__ as renderInternal } from '../src/tools/render-diagram.js';
import { __INTERNAL__ as makeInternal } from '../src/tools/make-diagram.js';

const SAMPLE_FLOWCHART = {
  kind: 'flowchart' as const,
  title: 'Order processing',
  nodes: [
    { id: 'A', label: 'Start', shape: 'box' as const },
    { id: 'B', label: 'Decide', shape: 'diamond' as const },
    { id: 'C', label: 'Pay', shape: 'box' as const },
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C', label: 'yes' },
  ],
};

const SAMPLE_SEQUENCE = {
  kind: 'sequence' as const,
  title: 'Login',
  actors: [
    { id: 'U', label: 'User' },
    { id: 'S', label: 'Server' },
  ],
  messages: [
    { from: 'U', to: 'S', label: 'POST /login', kind: 'sync' as const },
    { from: 'S', to: 'U', label: '200 OK', kind: 'return' as const },
  ],
};

const SAMPLE_ERD = {
  kind: 'erd' as const,
  title: 'Library',
  entities: [
    { id: 'Book', label: 'Book', attributes: ['id', 'title'] },
    { id: 'Author', label: 'Author', attributes: ['id', 'name'] },
  ],
  relations: [
    { from: 'Book', to: 'Author', fromCard: '*' as const, toCard: '1' as const, label: 'by' },
  ],
};

interface RenderResult {
  readonly svg: string;
  readonly mermaid: string;
  readonly html: string;
}

describe('AC-7: render_diagram determinism (in-process)', () => {
  it('two consecutive calls with the same input produce byte-equal SVG', () => {
    const a = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'light',
    }) as RenderResult;
    const b = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'light',
    }) as RenderResult;
    expect(Buffer.compare(Buffer.from(a.svg), Buffer.from(b.svg))).toBe(0);
    expect(Buffer.compare(Buffer.from(a.mermaid), Buffer.from(b.mermaid))).toBe(0);
  });

  it('ten consecutive calls produce byte-equal SVG across the loop', () => {
    const first = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'dark',
    }) as RenderResult;
    for (let i = 0; i < 10; i++) {
      const next = renderInternal.renderImpl({
        ir: SAMPLE_FLOWCHART,
        type: 'flowchart',
        theme: 'dark',
      }) as RenderResult;
      expect(Buffer.compare(Buffer.from(first.svg), Buffer.from(next.svg))).toBe(0);
    }
  });

  it('different themes produce different SVG', () => {
    const light = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'light',
    }) as RenderResult;
    const dark = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'dark',
    }) as RenderResult;
    expect(light.svg).not.toBe(dark.svg);
  });

  it('unknown theme returns ok=true and produces the same SVG as light', () => {
    const a = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'light',
    }) as RenderResult;
    const b = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'neon',
    }) as RenderResult;
    expect(Buffer.compare(Buffer.from(a.svg), Buffer.from(b.svg))).toBe(0);
  });

  it('all three diagram types round-trip without throwing', () => {
    expect(() =>
      renderInternal.renderImpl({ ir: SAMPLE_FLOWCHART, type: 'flowchart', theme: 'light' }),
    ).not.toThrow();
    expect(() =>
      renderInternal.renderImpl({ ir: SAMPLE_SEQUENCE, type: 'sequence', theme: 'light' }),
    ).not.toThrow();
    expect(() =>
      renderInternal.renderImpl({ ir: SAMPLE_ERD, type: 'erd', theme: 'light' }),
    ).not.toThrow();
  });
});

describe('AC-7: unknown theme fallback emits exactly one stderr line', () => {
  let captured = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  beforeAll(() => {
    captured = '';
    // Monkey-patch stderr.write to capture into a buffer without
    // touching the test runner's own logger.
    (process.stderr as unknown as { write: (s: string) => boolean }).write = ((
      chunk: string | Buffer,
    ): boolean => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      return true;
    });
  });
  afterAll(() => {
    (process.stderr as unknown as { write: (s: string) => boolean }).write = origWrite as never;
  });

  it('emits exactly one [render_diagram] unknown theme line per call', () => {
    captured = '';
    renderInternal.renderImpl({ ir: SAMPLE_FLOWCHART, type: 'flowchart', theme: 'cobalt' });
    const lines = captured
      .split('\n')
      .filter((l) => l.includes('[render_diagram]') && l.includes('unknown theme'));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/unknown theme "cobalt" → light/);
  });
});

describe('AC-7: make_diagram summary contains the unknown theme marker', () => {
  it('summary string includes [theme: unknown → light] when theme is unknown', async () => {
    const result = await makeInternal.makeImpl({
      text: 'flowchart: Demo\nA -> B',
      theme: 'neon',
    });
    expect(result.summary).toMatch(/\[theme: neon → light\]/);
    expect(result.manifest.theme).toBe('light');
  });

  it('summary does not include the marker when theme is shipped', async () => {
    const result = await makeInternal.makeImpl({
      text: 'flowchart: Demo\nA -> B',
      theme: 'dark',
    });
    expect(result.summary).not.toMatch(/\[theme:/);
    expect(result.manifest.theme).toBe('dark');
  });
});

describe('AC-7: render_diagram stdio round-trip', () => {
  let client: StdioClient | null = null;
  afterAll(async () => {
    if (client) await client.close();
  });

  it('two consecutive calls return byte-equal svg strings', async () => {
    client = new StdioClient();
    await client.initialize();
    const a = await client.callTool<RenderResult>('render_diagram', {
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'blueprint',
    });
    const b = await client.callTool<RenderResult>('render_diagram', {
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'blueprint',
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Buffer.compare(Buffer.from(a.value.svg), Buffer.from(b.value.svg))).toBe(0);
  }, 15_000);
});

// Smoke check that the tool output envelope shape is unchanged.
describe('AC-7: tool envelope shape', () => {
  it('render_diagram result includes svg, mermaid, html keys', () => {
    const r = renderInternal.renderImpl({
      ir: SAMPLE_FLOWCHART,
      type: 'flowchart',
      theme: 'light',
    }) as RenderResult;
    expect(typeof r.svg).toBe('string');
    expect(typeof r.mermaid).toBe('string');
    expect(typeof r.html).toBe('string');
  });
});
