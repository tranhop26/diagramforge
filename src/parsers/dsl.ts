/**
 * Line-based DSL parser: plain text → `DiagramIR`.
 *
 * Grammar (one statement per line, `#` introduces a comment, blank lines
 * are skipped). The first non-empty line may be a type-and-title prefix:
 *
 *     flowchart: Order processing
 *     sequence: User login
 *     erd: Library schema
 *
 * The type prefix is optional; if absent the parser uses the `typeHint`
 * argument or falls back to `flowchart`. Every IR shape is a tagged
 * union on `kind` so downstream code can narrow with a single check.
 *
 * Per-line grammar by diagram kind:
 *
 *   Flowchart:
 *     <id>                       declare node, default label = id, shape = box
 *     <id>: <label>              declare node with explicit label
 *     <id> [<shape>]: <label>    declare node with shape and label
 *     <id> -> <id>               edge
 *     <id> -> <id>: <label>      edge with label
 *     <id> --> <id>: <label>     edge with label (alternate spelling)
 *     <id> -- <id>: <label>      undirected edge with label
 *
 *   Sequence:
 *     actor <id>                 declare actor, label = id
 *     actor <id>: <label>        declare actor with label
 *     <id> -> <id>: <message>    sync message
 *     <id> --> <id>: <message>   return message (dashed arrow in render)
 *     <id> ->> <id>: <message>   async message
 *
 *   ERD:
 *     entity <id>                          declare entity
 *     entity <id>: <label>                 declare entity with label
 *     entity <id> { a, b, c }              declare with attributes
 *     entity <id>: <label> { a, b, c }     declare with label and attributes
 *     <id1> ||--|| <id2> : <label>         1:1 relation
 *     <id1> ||--o{ <id2> : <label>         1:many relation
 *     <id1> }o--|| <id2> : <label>         many:1 relation
 *     <id1> }o--o{ <id2> : <label>         many:many relation
 *
 * IDs match `[A-Za-z_][A-Za-z0-9_]*` (the same shape the Mermaid output
 * uses, AC-10). Malformed lines are silently skipped — the parser must
 * be a safe fallback for arbitrary prose (AC-6). An input that yields
 * no recognised lines produces an empty IR of the chosen kind.
 *
 * This module is pure: no env reads, no I/O, no clock, no random source.
 * `parseDsl` is therefore byte-deterministic: two calls with the same
 * `text` and `typeHint` produce deep-equal IR JSON.
 */
import type {
  DiagramIR,
  DiagramType,
  ErdCardinality,
  ErdEntity,
  ErdIR,
  ErdRelation,
  FlowchartEdge,
  FlowchartIR,
  FlowchartNode,
  FlowchartShape,
  SequenceActor,
  SequenceIR,
  SequenceMessage,
  SequenceMessageKind,
} from '../types.js';

/** Valid id characters: ASCII letter / underscore followed by word chars. */
const ID_RE = /[A-Za-z_][A-Za-z0-9_]*/;

/** Capturing group version for parsing. */
const ID_GROUP_RE = /([A-Za-z_][A-Za-z0-9_]*)/;

/** Type-prefix line: `flowchart: Title` / `sequence: Title` / `erd: Title`. */
const TYPE_PREFIX_RE = /^(flowchart|sequence|erd)\s*:\s*(.*)$/i;

/** Flowchart node declaration with shape: `id [shape]: label`. */
const FLOW_NODE_SHAPE_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[(box|round|diamond|parallelogram)\]\s*:\s*(.+)$/i;

/** Flowchart node declaration with label: `id: label`. */
const FLOW_NODE_LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/;

/** Flowchart edge with label: `id -> id: label`, `id --> id: label`, `id -- id: label`. */
const FLOW_EDGE_LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(->|--)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/;

/** Flowchart edge without label: `id -> id`, `id -- id`. */
const FLOW_EDGE_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(->|--)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/** Bare flowchart node id (line that is just an id). */
const FLOW_BARE_ID_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/** Sequence actor with label: `actor id: label`. */
const SEQ_ACTOR_LABEL_RE = /^actor\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/i;

/** Sequence actor without label: `actor id`. */
const SEQ_ACTOR_BARE_RE = /^actor\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i;

/** Sequence message: `id OP id: label` where OP is `->` (sync), `-->` (return), `->>` (async). */
const SEQ_MESSAGE_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(->|--|->>)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/;

/** ERD entity: `entity id: label { a, b }` (label and attrs both optional). */
const ERD_ENTITY_RE = /^entity\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^{]+?))?(?:\s*\{([^}]*)\})?\s*$/i;

/**
 * ERD relation: `id1 (lhs)(dashes)(rhs) id2 : label`.
 *   lhs / rhs are one of `||`, `o|`, `}|`, `o{`, `}o` (Mermaid ERD markers).
 *   dashes are 2-3 hyphens.
 */
const ERD_RELATION_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s+(\|\||o\||}\||o{|}o)(-{-2,3})(\|\||o\||}\||o{|}o)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/;

export interface DslParseResult {
  ir: DiagramIR;
  via: 'dsl';
}

/** Sequence of DSL token strings that signal "this is a DSL input, not prose". */
const DSL_TOKENS: ReadonlyArray<RegExp> = [
  TYPE_PREFIX_RE, // `flowchart:`, `sequence:`, `erd:`
  SEQ_ACTOR_LABEL_RE,
  SEQ_ACTOR_BARE_RE,
  ERD_ENTITY_RE,
  FLOW_EDGE_LABEL_RE,
  FLOW_EDGE_RE,
  FLOW_NODE_SHAPE_RE,
  SEQ_MESSAGE_RE,
  ERD_RELATION_RE,
];

/**
 * Heuristic: does this text look like DSL (line-based grammar) or like
 * free-form prose? The LLM route is only attempted on prose (AC-6).
 *
 * The check is permissive: anything matching the DSL grammar is treated
 * as DSL, even if it is single-line. Pure prose (no arrows, no actor
 * /entity/edge tokens, no type prefix) routes to the LLM.
 */
export function looksLikeDsl(text: string): boolean {
  // The first-line type prefix is the strongest signal.
  if (TYPE_PREFIX_RE.test(firstNonEmptyLine(text))) return true;
  for (const re of DSL_TOKENS) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Parse a `text` spec into a `DiagramIR`. The parser never throws on
 * malformed input — it silently skips lines that don't match the
 * grammar, and returns an empty IR if nothing parses.
 */
export function parseDsl(text: string, typeHint?: DiagramType): DslParseResult {
  const rawLines = text.split(/\r?\n/);
  let kind: DiagramType;
  let title: string;
  let bodyLines: string[];

  const first = firstNonEmptyLine(text);
  const prefix = TYPE_PREFIX_RE.exec(first);
  if (prefix) {
    kind = prefix[1].toLowerCase() as DiagramType;
    title = prefix[2].trim();
    // Drop the prefix line from the body.
    bodyLines = dropFirstMatchingLine(rawLines, first);
  } else {
    kind = typeHint ?? 'flowchart';
    title = '';
    bodyLines = rawLines;
  }

  const cleaned = bodyLines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  switch (kind) {
    case 'flowchart':
      return { ir: parseFlowchart(cleaned, title), via: 'dsl' };
    case 'sequence':
      return { ir: parseSequence(cleaned, title), via: 'dsl' };
    case 'erd':
      return { ir: parseErd(cleaned, title), via: 'dsl' };
  }
}

// ---------------------------------------------------------------------------
// Flowchart
// ---------------------------------------------------------------------------

function parseFlowchart(lines: ReadonlyArray<string>, title: string): FlowchartIR {
  const nodes: FlowchartNode[] = [];
  const edges: FlowchartEdge[] = [];
  const seen = new Set<string>();

  const addNode = (id: string, label: string, shape: FlowchartShape): void => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, shape });
  };

  for (const line of lines) {
    const mShape = FLOW_NODE_SHAPE_RE.exec(line);
    if (mShape) {
      const [, id, shape, label] = mShape as unknown as [string, string, FlowchartShape, string];
      addNode(id, label.trim(), shape.toLowerCase() as FlowchartShape);
      continue;
    }
    const mEdgeLabel = FLOW_EDGE_LABEL_RE.exec(line);
    if (mEdgeLabel) {
      const [, from, , to, label] = mEdgeLabel as unknown as [string, string, string, string, string];
      addNode(from, from, 'box');
      addNode(to, to, 'box');
      edges.push({ from, to, label: label.trim() });
      continue;
    }
    const mEdge = FLOW_EDGE_RE.exec(line);
    if (mEdge) {
      const [, from, , to] = mEdge as unknown as [string, string, string, string];
      addNode(from, from, 'box');
      addNode(to, to, 'box');
      edges.push({ from, to });
      continue;
    }
    const mLabel = FLOW_NODE_LABEL_RE.exec(line);
    if (mLabel) {
      const [, id, label] = mLabel as unknown as [string, string, string];
      addNode(id, label.trim(), 'box');
      continue;
    }
    const mBare = FLOW_BARE_ID_RE.exec(line);
    if (mBare) {
      const [, id] = mBare as unknown as [string, string];
      addNode(id, id, 'box');
      continue;
    }
    // Unrecognised line — skip silently.
  }

  return { kind: 'flowchart', title, nodes, edges };
}

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

function parseSequence(lines: ReadonlyArray<string>, title: string): SequenceIR {
  const actors: SequenceActor[] = [];
  const messages: SequenceMessage[] = [];
  const seen = new Set<string>();

  const addActor = (id: string, label: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    actors.push({ id, label });
  };

  for (const line of lines) {
    const mActorLabel = SEQ_ACTOR_LABEL_RE.exec(line);
    if (mActorLabel) {
      const [, id, label] = mActorLabel as unknown as [string, string, string];
      addActor(id, label.trim());
      continue;
    }
    const mActorBare = SEQ_ACTOR_BARE_RE.exec(line);
    if (mActorBare) {
      const [, id] = mActorBare as unknown as [string, string];
      addActor(id, id);
      continue;
    }
    const mMsg = SEQ_MESSAGE_RE.exec(line);
    if (mMsg) {
      const [, from, op, to, label] = mMsg as unknown as [string, string, string, string, string];
      addActor(from, from);
      addActor(to, to);
      messages.push({ from, to, label: label.trim(), kind: opToKind(op) });
      continue;
    }
    // Unrecognised line — skip silently.
  }

  return { kind: 'sequence', title, actors, messages };
}

function opToKind(op: string): SequenceMessageKind {
  if (op === '-->') return 'return';
  if (op === '->>') return 'async';
  return 'sync';
}

// ---------------------------------------------------------------------------
// ERD
// ---------------------------------------------------------------------------

function parseErd(lines: ReadonlyArray<string>, title: string): ErdIR {
  const entities: ErdEntity[] = [];
  const relations: ErdRelation[] = [];
  const seen = new Set<string>();

  const addEntity = (id: string, label: string, attributes: ReadonlyArray<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    entities.push({ id, label, attributes });
  };

  for (const line of lines) {
    const mEnt = ERD_ENTITY_RE.exec(line);
    if (mEnt) {
      const [, id, rawLabel, rawAttrs] = mEnt as unknown as [string, string, string | undefined, string | undefined];
      const label = (rawLabel ?? id).trim();
      const attributes = rawAttrs
        ? rawAttrs.split(',').map((a) => a.trim()).filter((a) => a.length > 0)
        : [];
      addEntity(id, label, attributes);
      continue;
    }
    const mRel = ERD_RELATION_RE.exec(line);
    if (mRel) {
      const [, from, lhs, , rhs, to, label] = mRel as unknown as [string, string, string, string, string | undefined, string, string];
      addEntity(from, from, []);
      addEntity(to, to, []);
      relations.push({
        from,
        to,
        label: label.trim(),
        fromCard: cardFromMarker(lhs),
        toCard: cardFromMarker(rhs ?? lhs),
      });
      continue;
    }
    // Unrecognised line — skip silently.
  }

  return { kind: 'erd', title, entities, relations };
}

function cardFromMarker(marker: string): ErdCardinality {
  // Mermaid ERD markers: `||` / `o|` = exactly one; `o{` / `}o` / `}|` = many.
  if (marker === '||' || marker === 'o|') return '1';
  return '*';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#')) return t;
  }
  return '';
}

function dropFirstMatchingLine(lines: ReadonlyArray<string>, target: string): string[] {
  const out: string[] = [];
  let dropped = false;
  for (const l of lines) {
    if (!dropped && l.trim() === target) {
      dropped = true;
      continue;
    }
    out.push(l);
  }
  return out;
}

/** Re-export for tests / introspection. */
export const __INTERNAL__ = { ID_RE, ID_GROUP_RE };
