/**
 * Tool handler utilities.
 *
 * Every MCP tool in DiagramForge is wrapped in `tryOk(...)` so that a thrown
 * error never escapes the handler boundary. The plan requires handlers to
 * "never throw"; `tryOk` is the safety net that converts any throw into the
 * `ToolOutput<T>` error envelope.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolOutput } from '../types.js';

/** Best-effort stringification of an unknown caught value. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}

/**
 * Run `fn`, return a `CallToolResult` whose `text` content block carries
 * the JSON-serialized `ToolOutput<T>` envelope. On throw, returns an
 * `isError: true` result carrying the error envelope — the handler itself
 * never propagates the throw.
 */
export async function tryOk<T>(fn: () => Promise<T> | T): Promise<CallToolResult> {
  try {
    const value = await fn();
    const envelope: ToolOutput<T> = { ok: true, value };
    return {
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
    };
  } catch (err) {
    const envelope: ToolOutput<never> = { ok: false, error: errMsg(err) };
    return {
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      isError: true,
    };
  }
}

/**
 * Format a zod issue list into a single human-readable error string,
 * prefixed with the tool name so logs are unambiguous.
 */
export function formatZodIssues(
  toolName: string,
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  const detail = issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  return `[${toolName}] invalid input — ${detail}`;
}
