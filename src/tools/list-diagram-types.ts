/**
 * `list_diagram_types` tool — returns the static catalog of diagram kinds and
 * themes DiagramForge can render. Pure, deterministic, no real input.
 *
 * The `inputSchema` is intentionally permissive (`z.object({}).passthrough().optional()`)
 * so the SDK passes the raw `arguments` to the handler instead of dropping them.
 * The strict "rejects extraneous keys" check happens inside the handler via
 * `safeParse`, so any failure surfaces as the `ToolOutput` error envelope
 * (AC-4) rather than a JSON-RPC protocol error.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatZodIssues, tryOk } from './_util.js';
import type {
  DiagramTypeInfo,
  ListDiagramTypesResult,
  ThemeInfo,
} from '../types.js';

const listDiagramTypesInputSchema = z
  .object({})
  .strict()
  .optional();

const TYPES: readonly DiagramTypeInfo[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    description:
      'Directed graph of nodes and edges. Shapes: box, round, diamond, parallelogram.',
  },
  {
    id: 'sequence',
    label: 'Sequence',
    description:
      'Actors and time-ordered messages (sync, async, return). Lifelines and activation bars.',
  },
  {
    id: 'erd',
    label: 'ERD',
    description:
      'Entities with attributes and one/many relations rendered as a schema diagram.',
  },
];

const THEMES: readonly ThemeInfo[] = [
  { id: 'light', label: 'Light', isDark: false },
  { id: 'dark', label: 'Dark', isDark: true },
  { id: 'blueprint', label: 'Blueprint', isDark: true },
];

export function registerListDiagramTypesTool(server: McpServer): void {
  server.registerTool(
    'list_diagram_types',
    {
      description:
        'List the diagram types and themes DiagramForge can render. Deterministic; takes no input.',
      inputSchema: z.object({}).passthrough().optional(),
    },
    async (args) =>
      tryOk<ListDiagramTypesResult>(() => listDiagramTypesImpl(args)),
  );
}

function listDiagramTypesImpl(args: unknown): ListDiagramTypesResult {
  const parsed = listDiagramTypesInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new Error(formatZodIssues('list_diagram_types', parsed.error.issues));
  }
  return { types: TYPES, themes: THEMES };
}
