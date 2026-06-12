/**
 * `parse_spec` tool — parses a text description into a `DiagramIR`.
 *
 * Routes:
 *   1. Line-based DSL input → DSL parser, no LLM call (`via: 'dsl'`).
 *   2. Prose + `OPENAI_API_KEY` set → LLM, with DSL fallback on failure
 *      (`via: 'llm'` or `via: 'heuristic'`). On fallback, one stderr
 *      line is logged by `parseProse`.
 *   3. Prose with no key → DSL parser, empty IR (`via: 'heuristic'`).
 *
 * The `inputSchema` is intentionally permissive so the SDK passes the
 * raw `arguments` to the handler. Strict validation happens inside
 * `parseSpecImpl` via `safeParse`, so any failure (missing field, wrong
 * type, unknown enum) is converted to the `ToolOutput` error envelope
 * by `tryOk` (AC-4) rather than a JSON-RPC protocol error.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatZodIssues, tryOk } from './_util.js';
import { parseProse } from '../parsers/prose.js';
import type { DiagramIR, DiagramType } from '../types.js';

const parseSpecInputSchema = z.object({
  text: z.string().min(1, 'text must be a non-empty string'),
  type: z.enum(['flowchart', 'sequence', 'erd']).optional(),
});

interface ParseSpecResult {
  ir: DiagramIR;
  /** Which route produced the IR: 'dsl' (line-based parser), 'llm', or 'heuristic' (fallback). */
  via: 'dsl' | 'llm' | 'heuristic';
}

export function registerParseSpecTool(server: McpServer): void {
  server.registerTool(
    'parse_spec',
    {
      description:
        'Parse a text spec into a DiagramIR. Input: { text: string, type?: "flowchart"|"sequence"|"erd" }. Offline line-based DSL; falls back to LLM for prose when OPENAI_API_KEY is set. Returns the IR and the route taken.',
      inputSchema: z.object({}).passthrough().optional(),
    },
    async (args) => tryOk<ParseSpecResult>(() => parseSpecImpl(args)),
  );
}

async function parseSpecImpl(args: unknown): Promise<ParseSpecResult> {
  const parsed = parseSpecInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(formatZodIssues('parse_spec', parsed.error.issues));
  }
  const { text, type } = parsed.data;
  const typeHint: DiagramType | undefined = type;
  return await parseProse(text, typeHint);
}
