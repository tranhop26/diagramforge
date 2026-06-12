/**
 * Prose parser: routes text input to the LLM (when configured) or the
 * DSL parser (always), and picks the right `via` tag for the response.
 *
 * Routing rules (AC-6):
 *
 *   1. If the input looks like DSL (any of the line-based grammar
 *      tokens are present), use the DSL parser directly. No LLM call.
 *      `via: 'dsl'`.
 *
 *   2. Otherwise, the input is treated as free-form prose. If
 *      `OPENAI_API_KEY` is set, call the LLM.
 *        - On success: `via: 'llm'`.
 *        - On any failure (network, auth, schema mismatch, parse):
 *          log ONE stderr line, fall back to the DSL parser, return
 *          `via: 'heuristic'`.
 *
 *   3. If the input is prose and no key is set, the DSL parser still
 *      runs (and returns an empty IR for unparseable prose). This is
 *      the same `via: 'heuristic'` path so the caller can detect the
 *      "no LLM was even attempted" case.
 *
 * The `via` field lets `make_diagram` (AC-11) annotate the manifest
 * summary so users can see which route actually produced the IR.
 */
import { parseDsl, looksLikeDsl, type DslParseResult } from './dsl.js';
import { parseWithLlm } from '../llm.js';
import type { DiagramIR, DiagramType } from '../types.js';

export type ParseVia = 'dsl' | 'llm' | 'heuristic';

export interface ParseProseResult {
  ir: DiagramIR;
  via: ParseVia;
}

/**
 * Public entry point. Always resolves; never throws. The caller
 * (parse_spec handler) wraps this in `tryOk` to surface any unexpected
 * error as a `{ok: false, error}` envelope.
 */
export async function parseProse(
  text: string,
  typeHint?: DiagramType,
): Promise<ParseProseResult> {
  // Route 1: DSL-shaped input goes straight to the DSL parser.
  if (looksLikeDsl(text)) {
    return parseDsl(text, typeHint);
  }

  // Route 2: prose + LLM configured → try LLM, fall back on failure.
  // Route 3: prose + no LLM configured → DSL parser (returns empty IR).
  const llmIr = await parseWithLlm(text, typeHint);
  if (llmIr !== null) {
    return { ir: llmIr, via: 'llm' };
  }

  // If the LLM was even attempted, this is the "fallback after LLM
  // failure" path — log one stderr line as the AC requires. If no LLM
  // was attempted (no key), we still take this path but skip the log.
  if (process.env['OPENAI_API_KEY']) {
    process.stderr.write('[parse_spec] LLM failed, falling back to DSL parser\n');
  }

  const fallback: DslParseResult = parseDsl(text, typeHint);
  return { ir: fallback.ir, via: 'heuristic' };
}
