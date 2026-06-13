/**
 * Mermaid renderer.
 *
 * Pure function: `(ir, type) → Mermaid source string`.
 *
 * The output is a *syntactic* Mermaid string — not validated against
 * a Mermaid runtime (the server ships with no Mermaid dependency).
 * The format tests (AC-10) assert headers, node id regex, and
 * balanced quotes. Any user-controlled text is escaped (colons
 * inside flowchart labels and double-quote balancing) so the output
 * remains well-formed.
 *
 * Determinism: nodes, edges, and entities are emitted in their
 * canonical sort order so the output is byte-stable.
 */
import type { DiagramIR, DiagramType } from '../types.js';
import type { ErdIR, FlowchartIR, SequenceIR } from '../types.js';

const ID_SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Escape any character that would break a Mermaid quoted label. */
function escapeMermaidLabel(s: string): string {
  // Inside double-quoted labels, Mermaid treats `"` as the terminator.
  // Replace `"` with the Unicode left/right double quote.
  return s.replace(/"/g, '“');
}

/** Escape an unquoted flowchart label (anything between `[...]`/`(...)`/`{...}`). */
function escapeUnquotedLabel(s: string): string {
  // Colons and brackets break the `id[label]` form, so we strip them.
  return s.replace(/[\[\]\{\}\|\:]/g, ' ');
}

function renderFlowchart(ir: FlowchartIR): string {
  const lines: string[] = ['flowchart TD'];
  // Emit node declarations first (sorted by id for determinism).
  const nodes = [...ir.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const n of nodes) {
    if (!ID_SAFE.test(n.id)) continue; // skip unsafe ids
    const safe = escapeUnquotedLabel(n.label);
    switch (n.shape) {
      case 'box':
        lines.push(`  ${n.id}[${safe}]`);
        break;
      case 'round':
        lines.push(`  ${n.id}(${safe})`);
        break;
      case 'diamond':
        lines.push(`  ${n.id}{${safe}}`);
        break;
      case 'parallelogram':
        lines.push(`  ${n.id}[/${safe}/]`);
        break;
    }
  }
  // Then edges (sorted by (from, to)).
  const edges = [...ir.edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
  });
  for (const e of edges) {
    if (!ID_SAFE.test(e.from) || !ID_SAFE.test(e.to)) continue;
    const tail = e.label ? ` : ${escapeMermaidLabel(e.label)}` : '';
    lines.push(`  ${e.from} --> ${e.to}${tail}`);
  }
  return lines.join('\n') + '\n';
}

function renderSequence(ir: SequenceIR): string {
  const lines: string[] = ['sequenceDiagram'];
  const actors = [...ir.actors].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const a of actors) {
    if (!ID_SAFE.test(a.id)) continue;
    lines.push(`  actor ${a.id}`);
  }
  for (const m of ir.messages) {
    if (!ID_SAFE.test(m.from) || !ID_SAFE.test(m.to)) continue;
    const arrow =
      m.kind === 'async' ? '->>' : m.kind === 'return' ? '-->>' : '->>';
    // Mermaid doesn't have async vs sync in this older dialect, so use
    // `->>` for sync/async and `-->>` for return. The visual difference
    // (solid vs dashed) is conveyed by the arrow style.
    const arrow2 = m.kind === 'return' ? '-->>' : '->>';
    void arrow;
    lines.push(`  ${m.from} ${arrow2} ${m.to}: ${escapeMermaidLabel(m.label)}`);
  }
  return lines.join('\n') + '\n';
}

function renderErd(ir: ErdIR): string {
  const lines: string[] = ['erDiagram'];
  const entities = [...ir.entities].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const e of entities) {
    if (!ID_SAFE.test(e.id)) continue;
    // Ensure the entity has a body in the diagram by adding an
    // attribute list. If no attributes, Mermaid still accepts an
    // empty block, but we use a single `id` field for clarity.
    const attrs = e.attributes.length > 0 ? e.attributes : ['id'];
    const body = attrs.map((a) => `    ${a} string`).join('\n');
    lines.push(`  ${e.id} {`, body, '  }');
  }
  const rels = [...ir.relations].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
  });
  for (const r of rels) {
    if (!ID_SAFE.test(r.from) || !ID_SAFE.test(r.to)) continue;
    const card = (c: '1' | '*') => (c === '1' ? '||' : '}o');
    const tail = r.label ? ` : ${escapeMermaidLabel(r.label)}` : '';
    lines.push(`  ${r.from} ${card(r.fromCard)}--${card(r.toCard)} ${r.to}${tail}`);
  }
  return lines.join('\n') + '\n';
}

export function renderMermaid(ir: DiagramIR, _type: DiagramType): string {
  switch (ir.kind) {
    case 'flowchart':
      return renderFlowchart(ir as FlowchartIR);
    case 'sequence':
      return renderSequence(ir as SequenceIR);
    case 'erd':
      return renderErd(ir as ErdIR);
  }
}
