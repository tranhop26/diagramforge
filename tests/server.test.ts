/**
 * MCP stdio server smoke test (AC-3).
 *
 * The full tools/list handshake is exercised by `scripts/probe-tools.js`.
 * Here we just confirm that each of the four required tools answers a
 * call, which is enough to prove the server is wired correctly and
 * remains alive.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { StdioClient } from './_helpers.js';

const EXPECTED_TOOLS = [
  'list_diagram_types',
  'parse_spec',
  'render_diagram',
  'make_diagram',
] as const;

describe('MCP stdio server (AC-3)', () => {
  let client: StdioClient | null = null;
  afterEach(async () => {
    if (client) await client.close();
    client = null;
  });

  it('the four required tool names are reachable via callTool', async () => {
    client = new StdioClient();
    await client.initialize();
    for (const name of EXPECTED_TOOLS) {
      const args: Record<string, unknown> =
        name === 'list_diagram_types'
          ? {}
          : name === 'parse_spec'
            ? { text: 'demo' }
            : name === 'render_diagram'
              ? {
                  ir: { kind: 'flowchart', title: '', nodes: [], edges: [] },
                  type: 'flowchart',
                  theme: 'light',
                }
              : { text: 'demo' };
      const result = await client.callTool(name, args);
      expect(result.ok).toBe(true);
    }
  }, 15_000);
});
