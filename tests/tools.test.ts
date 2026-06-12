/**
 * Tool-level tests.
 *
 *  - AC-4: every tool must return valid JSON, and any failure — bad input or
 *    an internal throw — must surface as `{ ok: false, error: <non-empty string> }`.
 *    Handlers never propagate throws.
 *  - AC-5: `list_diagram_types` returns ≥ 3 types (flowchart, sequence, erd)
 *    and ≥ 3 themes (light, dark, blueprint), and the result is fully
 *    deterministic across calls.
 *  - AC-3 (server process survives bad input): the stdio server must remain
 *    alive after a barrage of malformed calls and still answer a good call.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioClient } from './_helpers.js';
import type {
  DiagramType,
  ListDiagramTypesResult,
  ThemeName,
  ToolOutput,
} from '../src/types.js';

interface ServerState {
  client: StdioClient;
}

const state: ServerState = {} as ServerState;

beforeAll(async () => {
  state.client = new StdioClient();
  await state.client.initialize();
}, 15_000);

afterAll(async () => {
  if (state.client) await state.client.close();
});

async function expectErrorEnvelope(
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await state.client.callTool<ToolOutput<unknown>>(name, args);
  expect(result).toBeDefined();
  expect(result.ok).toBe(false);
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
}

describe('AC-4: tool error envelopes', () => {
  describe('list_diagram_types', () => {
    it('rejects extraneous arguments', async () => {
      await expectErrorEnvelope('list_diagram_types', { type: 'flowchart' });
    });
  });

  describe('parse_spec', () => {
    it('rejects missing `text`', async () => {
      await expectErrorEnvelope('parse_spec', {});
    });

    it('rejects empty `text`', async () => {
      await expectErrorEnvelope('parse_spec', { text: '' });
    });

    it('rejects wrong type for `text`', async () => {
      await expectErrorEnvelope('parse_spec', { text: 42 });
    });

    it('rejects unknown diagram `type` enum', async () => {
      await expectErrorEnvelope('parse_spec', {
        text: 'demo',
        type: 'gantt',
      });
    });
  });

  describe('render_diagram', () => {
    it('rejects missing required fields', async () => {
      await expectErrorEnvelope('render_diagram', {});
    });

    it('rejects wrong `theme` enum', async () => {
      await expectErrorEnvelope('render_diagram', {
        ir: { kind: 'flowchart', title: '', nodes: [], edges: [] },
        type: 'flowchart',
        theme: 'neon',
      });
    });

    it('rejects wrong `type` enum', async () => {
      await expectErrorEnvelope('render_diagram', {
        ir: {},
        type: 'mindmap',
        theme: 'light',
      });
    });
  });

  describe('make_diagram', () => {
    it('rejects missing `text`', async () => {
      await expectErrorEnvelope('make_diagram', {});
    });

    it('rejects wrong `theme` enum', async () => {
      await expectErrorEnvelope('make_diagram', {
        text: 'demo',
        theme: 'solarized',
      });
    });

    it('rejects wrong `type` enum', async () => {
      await expectErrorEnvelope('make_diagram', {
        text: 'demo',
        type: 'mindmap',
      });
    });
  });
});

describe('AC-5: list_diagram_types catalog', () => {
  it('returns the three required diagram types (flowchart, sequence, erd)', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { types } = result.value;
    const ids = new Set(types.map((t) => t.id));
    expect(ids.has('flowchart')).toBe(true);
    expect(ids.has('sequence')).toBe(true);
    expect(ids.has('erd')).toBe(true);
  });

  it('returns at least 3 diagram types', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.types.length).toBeGreaterThanOrEqual(3);
  });

  it('returns the three required themes (light, dark, blueprint)', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = new Set(result.value.themes.map((t) => t.id));
    expect(ids.has('light')).toBe(true);
    expect(ids.has('dark')).toBe(true);
    expect(ids.has('blueprint')).toBe(true);
  });

  it('returns at least 3 themes', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.themes.length).toBeGreaterThanOrEqual(3);
  });

  it('every type entry has non-empty id, label, and description', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const t of result.value.types) {
      expect(typeof t.id).toBe('string');
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.label).toBe('string');
      expect(t.label.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('every theme entry has non-empty id, label, and boolean isDark', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const th of result.value.themes) {
      expect(typeof th.id).toBe('string');
      expect(th.id.length).toBeGreaterThan(0);
      expect(typeof th.label).toBe('string');
      expect(th.label.length).toBeGreaterThan(0);
      expect(typeof th.isDark).toBe('boolean');
    }
  });

  it('diagram type ids are unique and all in the valid DiagramType set', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.types.map((t) => t.id);
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
    // Every id is a valid DiagramType literal.
    const valid: ReadonlySet<DiagramType> = new Set([
      'flowchart',
      'sequence',
      'erd',
    ]);
    for (const id of ids) {
      expect(valid.has(id as DiagramType)).toBe(true);
    }
  });

  it('theme ids are unique and all in the valid ThemeName set', async () => {
    const result = await state.client.callTool<ListDiagramTypesResult>(
      'list_diagram_types',
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.themes.map((t) => t.id);
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
    // Every id is a valid ThemeName literal.
    const valid: ReadonlySet<ThemeName> = new Set([
      'light',
      'dark',
      'blueprint',
    ]);
    for (const id of ids) {
      expect(valid.has(id as ThemeName)).toBe(true);
    }
  });

  it('is fully deterministic — two back-to-back calls return byte-identical JSON', async () => {
    // Compare the raw envelope text. Determinism means the string form must
    // match exactly; even key order must be stable.
    const a = await state.client.callToolRaw('list_diagram_types', {});
    const b = await state.client.callToolRaw('list_diagram_types', {});
    const aText = a.content?.[0]?.text ?? '';
    const bText = b.content?.[0]?.text ?? '';
    expect(aText).toBe(bText);
    expect(aText.length).toBeGreaterThan(0);
    // No timestamp / version / random field that would shift between calls.
    expect(aText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(aText).not.toMatch(/version/i);
    expect(aText).not.toMatch(/nonce/i);
  });

  it('is fully deterministic — five sequential calls return the same shape', async () => {
    // Concurrent variant: 5 calls fired in parallel, all must succeed and
    // serialize to the same string. This guards against any hidden
    // closure-captured state in the handler.
    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        state.client.callTool<ListDiagramTypesResult>('list_diagram_types', {}),
      ),
    );
    for (const c of calls) {
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.value.types.length).toBeGreaterThanOrEqual(3);
      expect(c.value.themes.length).toBeGreaterThanOrEqual(3);
    }
    const texts = await Promise.all(
      Array.from({ length: 5 }, () =>
        state.client.callToolRaw('list_diagram_types', {}),
      ),
    );
    const first = texts[0].content?.[0]?.text ?? '';
    for (const t of texts.slice(1)) {
      expect(t.content?.[0]?.text).toBe(first);
    }
  });
});

describe('AC-3 / AC-4 cross-cutting: server process survives bad input', () => {
  it('still answers a valid call after a barrage of bad calls', async () => {
    // First, send a long sequence of bad calls.
    await expectErrorEnvelope('parse_spec', {});
    await expectErrorEnvelope('render_diagram', { theme: 'light' });
    await expectErrorEnvelope('make_diagram', { text: '' });
    await expectErrorEnvelope('list_diagram_types', { junk: 1 });
    // The process must still be alive and able to handle a good call.
    // We use `parse_spec` with valid text rather than `list_diagram_types`
    // with `{}` because the SDK's per-tool no-schema handling for the
    // empty-args case has a quirk we sidestep here.
    const ok = await state.client.callTool('parse_spec', { text: 'demo' });
    expect(ok.ok).toBe(true);
  });
});
