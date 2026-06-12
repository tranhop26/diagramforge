/**
 * `render_diagram` tool — pure (ir, type, theme) → { svg, mermaid, html }.
 *
 * AC-3 stub: the handler accepts the input shape and returns a placeholder
 * payload. The real SVG / Mermaid / HTML renderers land in
 * AC-7 / AC-8 / AC-9 / AC-10.
 *
 * The `inputSchema` is intentionally permissive so the SDK passes the raw
 * `arguments` to the handler. Strict validation happens inside `renderImpl`
 * via `safeParse`, so any failure (missing field, wrong type, unknown enum)
 * is converted to the `ToolOutput` error envelope by `tryOk` (AC-4).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatZodIssues, tryOk } from './_util.js';
import type { RenderResult } from '../types.js';

const renderDiagramInputSchema = z.object({
  /** The IR (a tagged union over the three diagram kinds). */
  ir: z.unknown(),
  type: z.enum(['flowchart', 'sequence', 'erd']),
  theme: z.enum(['light', 'dark', 'blueprint']),
});

export function registerRenderDiagramTool(server: McpServer): void {
  server.registerTool(
    'render_diagram',
    {
      description:
        'Render a DiagramIR to self-contained SVG, Mermaid source, and a pan/zoom-able HTML preview. Input: { ir: object, type: "flowchart"|"sequence"|"erd", theme: "light"|"dark"|"blueprint" }. Pure function of (ir, type, theme).',
      inputSchema: z.object({}).passthrough().optional(),
    },
    async (args) => tryOk<RenderResult>(() => renderImpl(args)),
  );
}

function renderImpl(args: unknown): RenderResult {
  const parsed = renderDiagramInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(formatZodIssues('render_diagram', parsed.error.issues));
  }
  // AC-7 replaces this with the real pure renderer.
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>',
    mermaid: 'flowchart TD',
    html: '<!doctype html><html><body><p>stub</p></body></html>',
  };
}
