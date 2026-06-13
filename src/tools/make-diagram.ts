/**
 * `make_diagram` tool — orchestrates `parse_spec` then `render_diagram`.
 *
 * The handler validates input, calls `parseProse` (DSL parser + LLM
 * fallback), then runs the new pure renderer. The manifest counts
 * the IR's nodes/actors/entities and edges/messages/relations; the
 * summary is a single human-readable line. Unknown theme names
 * trigger the same fallback as `render_diagram`: theme → `light`,
 * one stderr line, and the summary string carries the
 * `[theme: unknown → light]` marker (AC-7 + AC-11).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatZodIssues, tryOk } from './_util.js';
import type {
  DiagramIR,
  DiagramType,
  MakeDiagramResult,
  Manifest,
  Theme,
  ThemeName,
} from '../types.js';
import { parseProse } from '../parsers/prose.js';
import { getTheme, ALL_THEMES } from '../themes/presets.js';
import { layoutFlowchart } from '../layout/flowchart.js';
import { layoutSequence } from '../layout/sequence.js';
import { layoutErd } from '../layout/erd.js';
import { renderSvg } from '../render/svg.js';
import { renderMermaid } from '../render/mermaid.js';
import { renderHtml } from '../render/html.js';
import type { Geometry } from '../layout/types.js';

const makeDiagramInputSchema = z.object({
  text: z.string().min(1, 'text must be a non-empty string'),
  type: z.enum(['flowchart', 'sequence', 'erd']).optional(),
  theme: z.string().optional(), // unknown names fall back to light
});

export function registerMakeDiagramTool(server: McpServer): void {
  server.registerTool(
    'make_diagram',
    {
      description:
        'One-shot: parse the text into an IR, render to SVG/Mermaid/HTML, and return a manifest plus a one-line summary. Input: { text: string, type?: "flowchart"|"sequence"|"erd", theme?: string }. Unknown theme falls back to "light" with a single stderr line.',
      inputSchema: z.object({}).passthrough().optional(),
    },
    async (args) => tryOk<MakeDiagramResult>(() => makeImpl(args)),
  );
}

async function makeImpl(args: unknown): Promise<MakeDiagramResult> {
  const parsed = makeDiagramInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(formatZodIssues('make_diagram', parsed.error.issues));
  }
  const { text, type, theme } = parsed.data;
  const { ir } = await parseProse(text, type);
  const resolvedType: DiagramType = type ?? ir.kind;
  const themeInput = theme ?? 'light';
  const themeResult = getTheme(themeInput);
  const wasFallback = themeResult.isFallback;
  if (wasFallback) {
    process.stderr.write(`[render_diagram] unknown theme "${themeInput}" → light\n`);
  }
  const resolvedTheme: Readonly<Theme> = themeResult.theme;
  const resolvedThemeName: ThemeName = resolvedTheme.name;

  const geometry: Geometry =
    ir.kind === 'flowchart'
      ? layoutFlowchart(ir as Extract<DiagramIR, { kind: 'flowchart' }>)
      : ir.kind === 'sequence'
        ? layoutSequence(ir as Extract<DiagramIR, { kind: 'sequence' }>)
        : layoutErd(ir as Extract<DiagramIR, { kind: 'erd' }>);

  const svg = renderSvg(geometry, resolvedTheme);
  const mermaid = renderMermaid(ir, resolvedType);
  const title = getTitle(ir);
  const nodeCount = countNodes(ir);
  const edgeCount = countEdges(ir);
  const manifest: Manifest = {
    type: resolvedType,
    theme: resolvedThemeName,
    nodeCount,
    edgeCount,
  };
  const html = renderHtml({ svg, manifest, title, allThemes: ALL_THEMES });
  const summary = buildSummary({
    type: resolvedType,
    title,
    nodeCount,
    edgeCount,
    theme: resolvedThemeName,
    unknownTheme: wasFallback ? themeInput : null,
  });
  return { svg, mermaid, html, manifest, summary };
}

function getTitle(ir: DiagramIR): string {
  return ir.title || ir.kind;
}

function countNodes(ir: DiagramIR): number {
  switch (ir.kind) {
    case 'flowchart':
      return ir.nodes.length;
    case 'sequence':
      return ir.actors.length;
    case 'erd':
      return ir.entities.length;
  }
}

function countEdges(ir: DiagramIR): number {
  switch (ir.kind) {
    case 'flowchart':
      return ir.edges.length;
    case 'sequence':
      return ir.messages.length;
    case 'erd':
      return ir.relations.length;
  }
}

function buildSummary(opts: {
  type: DiagramType;
  title: string;
  nodeCount: number;
  edgeCount: number;
  theme: ThemeName;
  unknownTheme: string | null;
}): string {
  const kindLabel = edgeCountLabel(opts.type);
  const base = `${opts.type}: ${opts.title} — ${opts.nodeCount} ${kindLabel.nodes}, ${opts.edgeCount} ${kindLabel.edges}, theme=${opts.theme}`;
  return opts.unknownTheme !== null
    ? `${base} [theme: ${opts.unknownTheme} → ${opts.theme}]`
    : base;
}

function edgeCountLabel(type: DiagramType): { nodes: string; edges: string } {
  switch (type) {
    case 'flowchart':
      return { nodes: 'nodes', edges: 'edges' };
    case 'sequence':
      return { nodes: 'actors', edges: 'messages' };
    case 'erd':
      return { nodes: 'entities', edges: 'relations' };
  }
}

export const __INTERNAL__ = { makeImpl };
