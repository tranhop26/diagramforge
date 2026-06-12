/**
 * LLM client wrapper.
 *
 * The server is "LLM-optional": with no `OPENAI_API_KEY` it runs offline
 * and the prose parser never makes a network call. With the env var set,
 * the prose parser (AC-6) routes free-form input to the LLM and falls
 * back to the DSL parser on any failure, logging one stderr line.
 *
 * The client is constructed per call from env vars so config changes
 * (or test-time overrides via `OPENAI_BASE_URL`) take effect immediately
 * — no module-level singleton.
 *
 * The LLM is asked for **strict IR JSON** via the OpenAI `json_object`
 * response format. The returned object is validated by zod before being
 * accepted; any failure (network, auth, schema, parse) returns `null`
 * and logs one line to stderr so the prose parser can fall back.
 *
 * Defaults match the deployment target:
 *   OPENAI_BASE_URL = https://token-ai.cysic.xyz/v1
 *   OPENAI_MODEL    = gpt-4o-mini
 */
import OpenAI from 'openai';
import { z } from 'zod';
import type {
  DiagramIR,
  DiagramType,
  ErdCardinality,
  ErdEntity,
  ErdRelation,
  FlowchartEdge,
  FlowchartNode,
  FlowchartShape,
  SequenceActor,
  SequenceMessage,
  SequenceMessageKind,
} from './types.js';

const DEFAULT_BASE_URL = 'https://token-ai.cysic.xyz/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
/** Per-call request timeout. LLM failures should not stall the server. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface LlmConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * Resolve the LLM config from process.env. Returns `null` when no key
 * is set — that is the signal to callers that they should skip the LLM
 * path entirely (no network attempt, no log line).
 */
export function getLlmConfig(): LlmConfig | null {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey || apiKey.length === 0) return null;
  return {
    apiKey,
    baseURL: process.env['OPENAI_BASE_URL'] ?? DEFAULT_BASE_URL,
    model: process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL,
  };
}

// ---------------------------------------------------------------------------
// zod schemas for LLM output validation. The LLM is asked to return IR
// shaped like our `DiagramIR` discriminated union; we narrow with zod so
// any shape mismatch is a clean `null` (with stderr log) for the caller.
// ---------------------------------------------------------------------------

const FlowchartShapeSchema = z.enum(['box', 'round', 'diamond', 'parallelogram']);
const SequenceKindSchema = z.enum(['sync', 'return', 'async']);
const ErdCardSchema = z.enum(['1', '*']);

const FlowchartNodeSchema = z.object({
  id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'id must be a valid identifier'),
  label: z.string(),
  shape: FlowchartShapeSchema.default('box'),
});

const FlowchartEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});

const FlowchartIrSchema = z.object({
  kind: z.literal('flowchart'),
  title: z.string().default(''),
  nodes: z.array(FlowchartNodeSchema),
  edges: z.array(FlowchartEdgeSchema),
});

const SequenceActorSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const SequenceMessageSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
  kind: SequenceKindSchema,
});

const SequenceIrSchema = z.object({
  kind: z.literal('sequence'),
  title: z.string().default(''),
  actors: z.array(SequenceActorSchema),
  messages: z.array(SequenceMessageSchema),
});

const ErdEntitySchema = z.object({
  id: z.string(),
  label: z.string(),
  attributes: z.array(z.string()),
});

const ErdRelationSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  fromCard: ErdCardSchema,
  toCard: ErdCardSchema,
});

const ErdIrSchema = z.object({
  kind: z.literal('erd'),
  title: z.string().default(''),
  entities: z.array(ErdEntitySchema),
  relations: z.array(ErdRelationSchema),
});

const IrSchema = z.discriminatedUnion('kind', [
  FlowchartIrSchema,
  SequenceIrSchema,
  ErdIrSchema,
]);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Strict system prompt: the LLM is told to return ONLY JSON shaped like
 * one of the three IR variants, with no surrounding prose, no
 * backticks, no commentary. The discriminated-union shape is described
 * in plain English so a non-fine-tuned model can follow it.
 */
function buildSystemPrompt(): string {
  return [
    'You convert a free-form natural-language description into a structured diagram IR.',
    'Reply with EXACTLY ONE JSON object — no prose, no markdown, no code fences, no trailing commentary.',
    'The object MUST have a string field "kind" equal to one of: "flowchart", "sequence", "erd".',
    'Choose the kind that best matches the description. Default to "flowchart" if unsure.',
    '',
    'For kind="flowchart": { "kind": "flowchart", "title": string, "nodes": [{"id": string, "label": string, "shape": "box"|"round"|"diamond"|"parallelogram"}], "edges": [{"from": string, "to": string, "label"?: string}] }',
    '  - "id" must match /^[A-Za-z_][A-Za-z0-9_]*$/.',
    '  - Every node id that appears in "edges" must also appear in "nodes".',
    '  - "shape" defaults to "box" if omitted.',
    '',
    'For kind="sequence": { "kind": "sequence", "title": string, "actors": [{"id": string, "label": string}], "messages": [{"from": string, "to": string, "label": string, "kind": "sync"|"return"|"async"}] }',
    '  - "kind" "sync" = solid arrow, "return" = dashed, "async" = open head.',
    '',
    'For kind="erd": { "kind": "erd", "title": string, "entities": [{"id": string, "label": string, "attributes": string[]}], "relations": [{"from": string, "to": string, "label"?: string, "fromCard": "1"|"*", "toCard": "1"|"*"}] }',
    '  - "fromCard" / "toCard" are the cardinality at the source / target side.',
    '',
    'Use empty arrays (not null) when a list has no entries. Use empty string for an unknown title.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Call the LLM to convert prose → IR. Returns `null` on ANY failure
 * (auth, network, schema mismatch, parse error, empty response); every
 * failure path also writes a single line to stderr.
 */
export async function parseWithLlm(
  text: string,
  typeHint?: DiagramType,
): Promise<DiagramIR | null> {
  const config = getLlmConfig();
  if (!config) return null;

  // The client is constructed per call so env changes apply immediately.
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: typeHint
            ? `diagram kind: ${typeHint}\n\ndescription:\n${text}`
            : `description:\n${text}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content || content.length === 0) {
      process.stderr.write('[llm] empty response\n');
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      process.stderr.write(`[llm] response is not valid JSON: ${(err as Error).message}\n`);
      return null;
    }

    const validated = IrSchema.safeParse(parsed);
    if (!validated.success) {
      process.stderr.write(
        `[llm] response failed schema validation: ${validated.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}\n`,
      );
      return null;
    }

    return freezeIr(validated.data);
  } catch (err) {
    process.stderr.write(`[llm] request failed: ${errMsg(err)}\n`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  return 'unknown error';
}

/**
 * Normalise the zod-parsed object into a frozen `DiagramIR`. zod's
 * default output is a plain mutable object, so we walk it once to
 * produce the readonly shape our downstream code expects. This also
 * gives us a single chokepoint for sorting/canonicalising lists
 * (insertion order is preserved — the layout engine sorts by id).
 */
function freezeIr(input: unknown): DiagramIR | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  switch (o['kind']) {
    case 'flowchart':
      return Object.freeze({
        kind: 'flowchart' as const,
        title: String(o['title'] ?? ''),
        nodes: Object.freeze(
          (Array.isArray(o['nodes']) ? o['nodes'] : []).map((n): FlowchartNode => {
            const node = n as Record<string, unknown>;
            return Object.freeze({
              id: String(node['id']),
              label: String(node['label'] ?? node['id']),
              shape: (node['shape'] as FlowchartShape) ?? 'box',
            });
          }),
        ),
        edges: Object.freeze(
          (Array.isArray(o['edges']) ? o['edges'] : []).map((e): FlowchartEdge => {
            const edge = e as Record<string, unknown>;
            const out: FlowchartEdge = {
              from: String(edge['from']),
              to: String(edge['to']),
              ...(edge['label'] !== undefined ? { label: String(edge['label']) } : {}),
            };
            return Object.freeze(out);
          }),
        ),
      });
    case 'sequence':
      return Object.freeze({
        kind: 'sequence' as const,
        title: String(o['title'] ?? ''),
        actors: Object.freeze(
          (Array.isArray(o['actors']) ? o['actors'] : []).map((a): SequenceActor => {
            const actor = a as Record<string, unknown>;
            return Object.freeze({
              id: String(actor['id']),
              label: String(actor['label'] ?? actor['id']),
            });
          }),
        ),
        messages: Object.freeze(
          (Array.isArray(o['messages']) ? o['messages'] : []).map((m): SequenceMessage => {
            const msg = m as Record<string, unknown>;
            return Object.freeze({
              from: String(msg['from']),
              to: String(msg['to']),
              label: String(msg['label'] ?? ''),
              kind: (msg['kind'] as SequenceMessageKind) ?? 'sync',
            });
          }),
        ),
      });
    case 'erd':
      return Object.freeze({
        kind: 'erd' as const,
        title: String(o['title'] ?? ''),
        entities: Object.freeze(
          (Array.isArray(o['entities']) ? o['entities'] : []).map((e): ErdEntity => {
            const ent = e as Record<string, unknown>;
            return Object.freeze({
              id: String(ent['id']),
              label: String(ent['label'] ?? ent['id']),
              attributes: Object.freeze(
                (Array.isArray(ent['attributes']) ? ent['attributes'] : []).map((a) => String(a)),
              ),
            });
          }),
        ),
        relations: Object.freeze(
          (Array.isArray(o['relations']) ? o['relations'] : []).map((r): ErdRelation => {
            const rel = r as Record<string, unknown>;
            const out: ErdRelation = {
              from: String(rel['from']),
              to: String(rel['to']),
              fromCard: (rel['fromCard'] as ErdCardinality) ?? '*',
              toCard: (rel['toCard'] as ErdCardinality) ?? '*',
              ...(rel['label'] !== undefined ? { label: String(rel['label']) } : {}),
            };
            return Object.freeze(out);
          }),
        ),
      });
    default:
      return null;
  }
}

// Exported for tests that want to assert the schema rejects bad shapes.
export const __SCHEMAS__ = {
  FlowchartIrSchema,
  SequenceIrSchema,
  ErdIrSchema,
  IrSchema,
};

/** Re-export of the zod-validated IR type for downstream code. */
export type LlmIrOutput = z.infer<typeof IrSchema>;
