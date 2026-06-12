/**
 * AC-6: `parse_spec` parses the line-based DSL deterministically offline
 * (no LLM) and returns `{ ok: true, ir }`. Free-form prose with
 * `OPENAI_API_KEY` set routes to the LLM; on any LLM failure, the
 * DSL/heuristic parser takes over and one stderr line is logged.
 *
 * Test groups:
 *   1. Pure unit tests of the DSL parser (in-process, no stdio).
 *   2. End-to-end DSL tests over the stdio server — same IR twice is
 *      byte-equal, and no LLM is contacted when `OPENAI_API_KEY` is
 *      not set.
 *   3. End-to-end prose + LLM-failure test — `OPENAI_API_KEY` is set
 *      but the URL points at a port nothing listens on; the server
 *      must still return `{ok: true, ir}` from the fallback parser
 *      AND emit exactly one stderr line.
 *   4. End-to-end prose + no-LLM test — `OPENAI_API_KEY` is unset;
 *      the server must NOT emit any LLM-failure stderr line (because
 *      no LLM was even attempted).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioClient } from './_helpers.js';
import { parseDsl, looksLikeDsl } from '../src/parsers/dsl.js';
import { parseProse, type ParseProseResult } from '../src/parsers/prose.js';
import type {
  DiagramIR,
  ErdIR,
  FlowchartIR,
  SequenceIR,
  ToolOutput,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// 1. Pure DSL parser unit tests
// ---------------------------------------------------------------------------

describe('AC-6: DSL parser (pure)', () => {
  it('looksLikeDsl: rejects free-form prose', () => {
    expect(looksLikeDsl('The user logs in and the server authenticates them.')).toBe(false);
    expect(looksLikeDsl('Hello world.')).toBe(false);
  });

  it('looksLikeDsl: accepts the type-prefix line', () => {
    expect(looksLikeDsl('flowchart: Demo')).toBe(true);
    expect(looksLikeDsl('sequence: Login')).toBe(true);
    expect(looksLikeDsl('erd: Library')).toBe(true);
  });

  it('looksLikeDsl: accepts actor/entity/edge tokens', () => {
    expect(looksLikeDsl('actor A')).toBe(true);
    expect(looksLikeDsl('entity Book { id }')).toBe(true);
    expect(looksLikeDsl('A -> B')).toBe(true);
  });

  it('parseDsl: flowchart with type prefix and one edge', () => {
    const r = parseDsl('flowchart: Demo\nA -> B');
    expect(r.via).toBe('dsl');
    expect(r.ir.kind).toBe('flowchart');
    const ir = r.ir as FlowchartIR;
    expect(ir.title).toBe('Demo');
    expect(ir.nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(ir.nodes.map((n) => n.label)).toEqual(['A', 'B']);
    expect(ir.edges.length).toBe(1);
    expect(ir.edges[0]).toEqual({ from: 'A', to: 'B' });
  });

  it('parseDsl: flowchart with node labels and edge label', () => {
    const r = parseDsl(
      [
        'flowchart: Order processing',
        'A: Start',
        'B [diamond]: Decide',
        'C: Pay',
        'A -> B',
        'B -> C: yes',
      ].join('\n'),
    );
    const ir = r.ir as FlowchartIR;
    expect(ir.title).toBe('Order processing');
    expect(ir.nodes).toEqual([
      { id: 'A', label: 'Start', shape: 'box' },
      { id: 'B', label: 'Decide', shape: 'diamond' },
      { id: 'C', label: 'Pay', shape: 'box' },
    ]);
    expect(ir.edges).toEqual([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C', label: 'yes' },
    ]);
  });

  it('parseDsl: sequence with actors and three message kinds', () => {
    const r = parseDsl(
      [
        'sequence: User login',
        'actor User',
        'actor Server: Application server',
        'actor DB',
        'User -> Server: POST /login',
        'Server ->> DB: query user',
        'DB --> Server: user record',
        'Server --> User: 200 OK',
      ].join('\n'),
    );
    const ir = r.ir as SequenceIR;
    expect(ir.title).toBe('User login');
    expect(ir.actors).toEqual([
      { id: 'User', label: 'User' },
      { id: 'Server', label: 'Application server' },
      { id: 'DB', label: 'DB' },
    ]);
    expect(ir.messages).toEqual([
      { from: 'User', to: 'Server', label: 'POST /login', kind: 'sync' },
      { from: 'Server', to: 'DB', label: 'query user', kind: 'async' },
      { from: 'DB', to: 'Server', label: 'user record', kind: 'return' },
      { from: 'Server', to: 'User', label: '200 OK', kind: 'return' },
    ]);
  });

  it('parseDsl: ERD with attributes and a 1:many relation', () => {
    const r = parseDsl(
      [
        'erd: Library',
        'entity Book { id, title, isbn }',
        'entity Author: Person name',
        'Book ||--o{ Author: written by',
      ].join('\n'),
    );
    const ir = r.ir as ErdIR;
    expect(ir.title).toBe('Library');
    expect(ir.entities).toEqual([
      { id: 'Book', label: 'Book', attributes: ['id', 'title', 'isbn'] },
      { id: 'Author', label: 'Person name', attributes: [] },
    ]);
    expect(ir.relations).toEqual([
      { from: 'Book', to: 'Author', label: 'written by', fromCard: '1', toCard: '*' },
    ]);
  });

  it('parseDsl: skips comments and blank lines', () => {
    const r = parseDsl(
      [
        '# this is a comment',
        '',
        'flowchart: Demo',
        '  # indented comment',
        'A -> B',
        '',
        'B -> C',
      ].join('\n'),
    );
    const ir = r.ir as FlowchartIR;
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C']);
    expect(ir.edges.length).toBe(2);
  });

  it('parseDsl: silently skips unrecognised lines', () => {
    const r = parseDsl(
      [
        'flowchart: Demo',
        'this line is total garbage ### !!!',
        'A -> B',
        '!!! -> ???',
        'C',
      ].join('\n'),
    );
    const ir = r.ir as FlowchartIR;
    // The garbage lines are dropped, but `C` is a valid bare id.
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C']);
    expect(ir.edges.length).toBe(1);
  });

  it('parseDsl: two calls with the same text return byte-equal IR', () => {
    const text = 'flowchart: Demo\nA -> B\nB -> C: next';
    const a = JSON.stringify(parseDsl(text).ir);
    const b = JSON.stringify(parseDsl(text).ir);
    expect(a).toBe(b);
  });

  it('parseDsl: empty input returns an empty IR of the hint type', () => {
    expect(parseDsl('', 'flowchart').ir).toEqual({
      kind: 'flowchart',
      title: '',
      nodes: [],
      edges: [],
    });
    expect(parseDsl('', 'sequence').ir).toEqual({
      kind: 'sequence',
      title: '',
      actors: [],
      messages: [],
    });
    expect(parseDsl('', 'erd').ir).toEqual({
      kind: 'erd',
      title: '',
      entities: [],
      relations: [],
    });
  });

  it('parseDsl: typeHint is used when there is no first-line type prefix', () => {
    // The first-line prefix is the strongest user signal and always wins.
    // The hint is consulted only when the prefix is absent.
    const withHint = parseDsl('A -> B', 'erd');
    expect(withHint.ir.kind).toBe('erd');
    // First-line prefix wins over the hint.
    const withPrefix = parseDsl('flowchart: x\nA -> B', 'erd');
    expect(withPrefix.ir.kind).toBe('flowchart');
    // Default without prefix or hint is flowchart.
    const withNeither = parseDsl('A -> B');
    expect(withNeither.ir.kind).toBe('flowchart');
  });

  it('parseDsl: shape defaults to box when omitted', () => {
    const r = parseDsl('flowchart: x\nA: alpha');
    const ir = r.ir as FlowchartIR;
    expect(ir.nodes[0]?.shape).toBe('box');
  });
});

// ---------------------------------------------------------------------------
// 2 & 3 & 4. End-to-end tests over the stdio server.
// We use one StdioClient per describe block because each one needs a
// different environment. A fresh client per `it` would mean spawning
// the server for every assertion (slow); a single shared client with
// a long-lived env is the right shape.
// ---------------------------------------------------------------------------

interface ServerState {
  client: StdioClient;
}

async function expectOkEnvelope(
  client: StdioClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutput<{ ir: DiagramIR; via: 'dsl' | 'llm' | 'heuristic' }>> {
  const result = await client.callTool<{ ir: DiagramIR; via: 'dsl' | 'llm' | 'heuristic' }>(
    name,
    args,
  );
  return result;
}

describe('AC-6: end-to-end DSL (no LLM env)', () => {
  const state: ServerState = {} as ServerState;
  beforeAll(async () => {
    // We explicitly clear OPENAI_API_KEY in the child process because
    // the test runner's parent env may have a key set (AC-1's other
    // tests rely on it). The server must see no key and use the DSL
    // parser for everything, never emitting any LLM-failure log.
    state.client = new StdioClient({
      env: { OPENAI_API_KEY: '' },
    });
    await state.client.initialize();
  }, 15_000);
  afterAll(async () => {
    if (state.client) await state.client.close();
  });

  it('flowchart DSL input returns IR via dsl', async () => {
    const r = await expectOkEnvelope(state.client, 'parse_spec', {
      text: 'flowchart: Demo\nA -> B',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.via).toBe('dsl');
    const ir = r.value.ir as FlowchartIR;
    expect(ir.kind).toBe('flowchart');
    expect(ir.title).toBe('Demo');
    expect(ir.nodes.length).toBe(2);
    expect(ir.edges.length).toBe(1);
  });

  it('two consecutive DSL calls return byte-equal IR JSON', async () => {
    const text = 'flowchart: Repeatable\nA: Start\nB: End\nA -> B: go';
    const a = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text,
    });
    const b = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it('sequence DSL input returns IR via dsl', async () => {
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'sequence: Login\nactor A\nactor B\nA -> B: hello\nB --> A: world',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.via).toBe('dsl');
    const ir = r.value.ir as SequenceIR;
    expect(ir.kind).toBe('sequence');
    expect(ir.actors.length).toBe(2);
    expect(ir.messages.length).toBe(2);
  });

  it('erd DSL input returns IR via dsl', async () => {
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'erd: Library\nentity Book { id }\nentity Author { id }\nBook ||--o{ Author: by',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.via).toBe('dsl');
    const ir = r.value.ir as ErdIR;
    expect(ir.kind).toBe('erd');
    expect(ir.entities.length).toBe(2);
    expect(ir.relations.length).toBe(1);
  });

  it('type hint narrows the parser kind', async () => {
    // The DSL prefix `flowchart:` is present, so even without a hint
    // the parser picks flowchart. The hint is only consulted when the
    // prefix is absent. We confirm the explicit-prefix path here.
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'sequence: Forced\nactor X\nactor Y\nX -> Y: hi',
      type: 'flowchart',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Explicit prefix wins over hint.
    expect(r.value.ir.kind).toBe('sequence');
  });

  it('pure prose with no LLM env still returns ok (heuristic empty IR)', async () => {
    state.client.drainStderr();
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'The user logs in, the server authenticates them, then returns 200 OK.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.via).toBe('heuristic');
    // No LLM was even attempted, so no fallback log.
    expect(state.client.drainStderr()).not.toMatch(/LLM failed/);
  });
});

describe('AC-6: end-to-end prose + LLM failure falls back to DSL', () => {
  const state: ServerState = {} as ServerState;
  beforeAll(async () => {
    // OPENAI_API_KEY is set so the server attempts the LLM route.
    // OPENAI_BASE_URL points at a port nothing is listening on, so
    // the network call fails and the DSL/heuristic fallback kicks in.
    state.client = new StdioClient({
      env: {
        OPENAI_API_KEY: 'test-stub-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:1', // privileged port, nothing listens
        OPENAI_MODEL: 'gpt-4o-mini',
      },
    });
    await state.client.initialize();
  }, 15_000);
  afterAll(async () => {
    if (state.client) await state.client.close();
  });

  it('prose input with OPENAI_API_KEY set still returns {ok: true, ir}', async () => {
    state.client.drainStderr();
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'The customer adds an item, pays, and receives a receipt.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // LLM failed → fallback to DSL → empty IR marked as heuristic.
    expect(r.value.via).toBe('heuristic');
    // The fallback IR is empty (prose has no DSL tokens), but the
    // shape is well-formed and carries a valid kind.
    expect(r.value.ir.kind).toMatch(/^(flowchart|sequence|erd)$/);
  }, 20_000);

  it('emits exactly one [parse_spec] fallback line on stderr', async () => {
    // Drain whatever the previous test left, then make a fresh call
    // and inspect stderr carefully.
    state.client.drainStderr();
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'A simple flow: the client sends a request, the server processes it.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Wait a beat for the stderr buffer to settle — the SDK writes
    // the LLM-failure log before the handler returns, but the
    // process-level pipe is asynchronous, so yield once.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stderr = state.client.drainStderr();
    const fallbackLines = stderr
      .split('\n')
      .filter((line) => line.includes('[parse_spec]') && line.includes('falling back'));
    expect(fallbackLines.length).toBe(1);
  }, 20_000);

  it('DSL-shaped input skips the LLM entirely (via dsl, no fallback log)', async () => {
    state.client.drainStderr();
    const r = await state.client.callTool<{ ir: DiagramIR; via: string }>('parse_spec', {
      text: 'flowchart: NoLLM\nA -> B',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.via).toBe('dsl');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stderr = state.client.drainStderr();
    // No fallback line, and no [llm] log either — DSL-shaped input
    // never reaches the LLM.
    expect(stderr).not.toMatch(/falling back/);
    expect(stderr).not.toMatch(/\[llm\]/);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Direct unit test of parseProse (in-process), to lock down the via
// routing without a stdio round-trip.
// ---------------------------------------------------------------------------

describe('AC-6: parseProse routing (in-process)', () => {
  it('DSL input returns via dsl', async () => {
    const r: ParseProseResult = await parseProse('flowchart: x\nA -> B');
    expect(r.via).toBe('dsl');
    expect(r.ir.kind).toBe('flowchart');
  });

  it('prose with no OPENAI_API_KEY returns via heuristic (no LLM attempted)', async () => {
    const prevKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const r = await parseProse('Just some prose, no DSL tokens here.');
      expect(r.via).toBe('heuristic');
      // The IR is empty (DSL parser skips prose lines).
      expect(r.ir.kind).toBe('flowchart');
    } finally {
      if (prevKey !== undefined) process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('prose with OPENAI_API_KEY but invalid URL falls back to heuristic', async () => {
    const prevKey = process.env['OPENAI_API_KEY'];
    const prevUrl = process.env['OPENAI_BASE_URL'];
    process.env['OPENAI_API_KEY'] = 'test-stub';
    process.env['OPENAI_BASE_URL'] = 'http://127.0.0.1:1';
    try {
      const r = await parseProse('Prose that would normally be sent to the LLM.');
      expect(r.via).toBe('heuristic');
    } finally {
      if (prevKey !== undefined) process.env['OPENAI_API_KEY'] = prevKey;
      else delete process.env['OPENAI_API_KEY'];
      if (prevUrl !== undefined) process.env['OPENAI_BASE_URL'] = prevUrl;
      else delete process.env['OPENAI_BASE_URL'];
    }
  }, 20_000);
});
