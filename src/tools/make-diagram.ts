/**
 * `make_diagram` tool — orchestrates `parse_spec` + `render_diagram`.
 *
 * AC-3 stub: handler accepts the input shape and returns a placeholder
 * manifest + summary. The real orchestration lands in AC-11.
 *
 * Input is validated manually with `safeParse` (see `parse-spec.ts` for the
 * AC-4 rationale).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatZodIssues, tryOk } from './_util.js';
import type { DiagramType, MakeDiagramResult, ThemeName } from '../types.js';

const makeDiagramInputSchema = z.object({
  text: z.string().min(1, 'text must be a non-empty string'),
  type: z.enum(['flowchart', 'sequence', 'erd']).optional(),
  theme: z.enum(['light', 'dark', 'blueprint']).optional(),
});

export function registerMakeDiagramTool(server: McpServer): void {
  server.registerTool(
    'make_diagram',
    {
      description:
        'One-shot: parse the text into an IR, render to SVG/Mermaid/HTML, and return a manifest plus a one-line summary. Input: { text: string, type?: "flowchart"|"sequence"|"erd", theme?: "light"|"dark"|"blueprint" }.',
      inputSchema: z.object({}).passthrough().optional(),
    },
    async (args) => tryOk<MakeDiagramResult>(() => makeImpl(args)),
  );
}

function makeImpl(args: unknown): MakeDiagramResult {
  const parsed = makeDiagramInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(formatZodIssues('make_diagram', parsed.error.issues));
  }
  const { text: _text, type, theme } = parsed.data;
  // AC-11 replaces this with parse_spec + render_diagram orchestration.
  const resolvedType: DiagramType = type ?? 'flowchart';
  const resolvedTheme: ThemeName = theme ?? 'light';
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>',
    mermaid: 'flowchart TD',
    html: '<!doctype html><html><body><p>stub</p></body></html>',
    manifest: {
      type: resolvedType,
      theme: resolvedTheme,
      nodeCount: 0,
      edgeCount: 0,
    },
    summary: `${resolvedType}: stub — 0 nodes, 0 edges, theme=${resolvedTheme}`,
  };
}
