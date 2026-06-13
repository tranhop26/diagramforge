/**
 * `render_diagram` tool — pure (ir, type, theme) → { svg, mermaid, html }.
 *
 * The handler is a thin validator wrapper around `renderImpl`,
 * which is a pure function: same `(ir, type, theme)` always produces
 * byte-equal `svg` (AC-7). Unknown themes fall back to `light` and
 * emit exactly one stderr line.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatZodIssues, tryOk } from './_util.js';
import type {
  DiagramIR,
  DiagramType,
  ErdIR,
  FlowchartIR,
  RenderResult,
  SequenceIR,
  Theme,
  ThemeName,
} from '../types.js';
import { getTheme, ALL_THEMES } from '../themes/presets.js';
import { layoutFlowchart } from '../layout/flowchart.js';
import { layoutSequence } from '../layout/sequence.js';
import { layoutErd } from '../layout/erd.js';
import { renderSvg } from '../render/svg.js';
import { renderMermaid } from '../render/mermaid.js';
import { renderHtml } from '../render/html.js';
import type { Geometry } from '../layout/types.js';

const renderDiagramInputSchema = z.object({
  ir: z.unknown(),
  type: z.enum(['flowchart', 'sequence', 'erd']),
  theme: z.string(), // accept any string; unknown names fall back to light
});

export function registerRenderDiagramTool(server: McpServer): void {
  server.registerTool(
    'render_diagram',
    {
      description:
        'Render a DiagramIR to self-contained SVG, Mermaid source, and a pan/zoom-able HTML preview. Input: { ir: object, type: "flowchart"|"sequence"|"erd", theme: string }. Pure function of (ir, type, theme). Unknown theme falls back to "light" and a single stderr line is logged.',
      inputSchema: z.object({}).passthrough().optional(),
    },
    async (args) => tryOk<RenderResult>(() => renderImpl(args)),
  );
}

function validateIr(type: DiagramType, ir: unknown): DiagramIR {
  if (!ir || typeof ir !== 'object') {
    throw new Error(`[render_diagram] invalid input — ir must be an object, got ${typeof ir}`);
  }
  const o = ir as Record<string, unknown>;
  if (o['kind'] !== type) {
    throw new Error(
      `[render_diagram] invalid input — ir.kind (${String(o['kind'])}) does not match type (${type})`,
    );
  }
  switch (type) {
    case 'flowchart': {
      const nodes = Array.isArray(o['nodes']) ? o['nodes'] : [];
      const edges = Array.isArray(o['edges']) ? o['edges'] : [];
      return {
        kind: 'flowchart',
        title: String(o['title'] ?? ''),
        nodes: nodes.map((n): FlowchartIR['nodes'][number] => {
          const node = n as Record<string, unknown>;
          return {
            id: String(node['id']),
            label: String(node['label'] ?? node['id']),
            shape: (node['shape'] as FlowchartIR['nodes'][number]['shape']) ?? 'box',
          };
        }),
        edges: edges.map((e): FlowchartIR['edges'][number] => {
          const edge = e as Record<string, unknown>;
          return {
            from: String(edge['from']),
            to: String(edge['to']),
            ...(edge['label'] !== undefined ? { label: String(edge['label']) } : {}),
          };
        }),
      };
    }
    case 'sequence': {
      const actors = Array.isArray(o['actors']) ? o['actors'] : [];
      const messages = Array.isArray(o['messages']) ? o['messages'] : [];
      return {
        kind: 'sequence',
        title: String(o['title'] ?? ''),
        actors: actors.map((a): SequenceIR['actors'][number] => {
          const actor = a as Record<string, unknown>;
          return {
            id: String(actor['id']),
            label: String(actor['label'] ?? actor['id']),
          };
        }),
        messages: messages.map((m): SequenceIR['messages'][number] => {
          const msg = m as Record<string, unknown>;
          return {
            from: String(msg['from']),
            to: String(msg['to']),
            label: String(msg['label'] ?? ''),
            kind: (msg['kind'] as SequenceIR['messages'][number]['kind']) ?? 'sync',
          };
        }),
      };
    }
    case 'erd': {
      const entities = Array.isArray(o['entities']) ? o['entities'] : [];
      const relations = Array.isArray(o['relations']) ? o['relations'] : [];
      return {
        kind: 'erd',
        title: String(o['title'] ?? ''),
        entities: entities.map((e): ErdIR['entities'][number] => {
          const ent = e as Record<string, unknown>;
          return {
            id: String(ent['id']),
            label: String(ent['label'] ?? ent['id']),
            attributes: Array.isArray(ent['attributes'])
              ? (ent['attributes'] as unknown[]).map((a) => String(a))
              : [],
          };
        }),
        relations: relations.map((r): ErdIR['relations'][number] => {
          const rel = r as Record<string, unknown>;
          return {
            from: String(rel['from']),
            to: String(rel['to']),
            fromCard: (rel['fromCard'] as '1' | '*') ?? '*',
            toCard: (rel['toCard'] as '1' | '*') ?? '*',
            ...(rel['label'] !== undefined ? { label: String(rel['label']) } : {}),
          };
        }),
      };
    }
  }
}

function renderImpl(args: unknown): RenderResult {
  const parsed = renderDiagramInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(formatZodIssues('render_diagram', parsed.error.issues));
  }
  const { ir, type, theme } = parsed.data;
  const validatedIr = validateIr(type, ir);
  const themeResult = getTheme(theme);
  if (themeResult.isFallback) {
    process.stderr.write(`[render_diagram] unknown theme "${theme}" → light\n`);
  }
  const resolvedTheme: Readonly<Theme> = themeResult.theme;
  const resolvedThemeName: ThemeName = resolvedTheme.name;
  const geometry: Geometry =
    validatedIr.kind === 'flowchart'
      ? layoutFlowchart(validatedIr)
      : validatedIr.kind === 'sequence'
        ? layoutSequence(validatedIr)
        : layoutErd(validatedIr);
  const svg = renderSvg(geometry, resolvedTheme);
  const mermaid = renderMermaid(validatedIr, type);
  const title = getTitle(validatedIr);
  const html = renderHtml({
    svg,
    manifest: {
      type,
      theme: resolvedThemeName,
      nodeCount: countNodes(validatedIr),
      edgeCount: countEdges(validatedIr),
    },
    title,
    allThemes: ALL_THEMES,
  });
  return { svg, mermaid, html };
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

export const __INTERNAL__ = { renderImpl };
