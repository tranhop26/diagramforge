/**
 * Shared stdio probe helpers for vitest.
 *
 * Spins up a fresh `dist/index.js` child process, exchanges the JSON-RPC
 * handshake, and provides a typed `callTool(name, args)` driver for
 * integration tests. Every test that talks to the server should use this
 * helper so a single change (e.g. a protocol upgrade) is reflected in
 * every test.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ToolOutput } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

const HANDSHAKE_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 10_000;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
}

interface CallToolContent {
  type: string;
  text?: string;
}

interface CallToolResult {
  content?: CallToolContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface StdioClientOptions {
  /**
   * Extra environment variables to merge into the child process env.
   * Useful for tests that need to flip OPENAI_API_KEY on, point
   * OPENAI_BASE_URL at a stub, or any other per-test config.
   */
  env?: Record<string, string>;
}

export class StdioClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private stderrBuf = '';
  private initialized = false;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (msg: JsonRpcMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly handshakeTimer: NodeJS.Timeout;
  private closed = false;

  constructor(opts: StdioClientOptions = {}) {
    this.proc = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env ?? {}), NODE_NO_WARNINGS: '1' },
    });
    this.handshakeTimer = setTimeout(() => {
      this.fail('stdio handshake timed out');
    }, HANDSHAKE_TIMEOUT_MS);
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      this.stderrBuf += chunk;
    });
    this.proc.on('error', (err) => this.fail(`spawn error: ${err.message}`));
    this.proc.on('exit', (code, signal) => {
      this.fail(`server exited (code=${code} signal=${signal})`);
    });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id)!;
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(`server error: ${JSON.stringify(msg.error)}`));
        } else {
          resolve(msg);
        }
      }
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.handshakeTimer);
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this.pending.clear();
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }

  private send(message: object): void {
    this.proc.stdin.write(JSON.stringify(message) + '\n');
  }

  private request<T>(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (m: JsonRpcMessage) => void, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Initialize the MCP session. Resolves once the server has ACKed. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'diagramforge-test', version: '0.0.0' },
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    clearTimeout(this.handshakeTimer);
    this.initialized = true;
  }

  /**
   * Call a tool and return the parsed `CallToolResult`. Throws if the
   * server returns a JSON-RPC protocol error (i.e. a thrown error that
   * `tryOk` did not catch — which would itself be a bug).
   */
  async callToolRaw(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<CallToolResult> {
    if (!this.initialized) await this.initialize();
    const msg = await this.request('tools/call', { name, arguments: args });
    return (msg.result as CallToolResult | undefined) ?? {};
  }

  /**
   * Call a tool and return the parsed `ToolOutput<T>` envelope. Throws if
   * the response content block is not a valid JSON envelope — which would
   * indicate a contract violation.
   */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolOutput<T>> {
    const raw = await this.callToolRaw(name, args);
    if (raw.isError) {
      return { ok: false, error: this.firstText(raw) ?? 'unknown error' };
    }
    const text = this.firstText(raw);
    if (text == null) {
      throw new Error('tool result has no text content');
    }
    try {
      return JSON.parse(text) as ToolOutput<T>;
    } catch (err) {
      throw new Error(
        `tool result is not valid JSON: ${(err as Error).message}; raw=${text.slice(0, 200)}`,
      );
    }
  }

  private firstText(raw: CallToolResult): string | null {
    const c = raw.content ?? [];
    for (const block of c) {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
    return null;
  }

  /** Tear down the child process. Idempotent. */
  async close(): Promise<void> {
    this.fail('close requested');
  }

  /**
   * Return the full stderr buffer captured since the client was
   * constructed, then reset it. Tests use this to assert that the
   * server emitted (or did not emit) particular stderr lines — e.g.
   * AC-6's "LLM failed, falling back to DSL parser" log.
   */
  drainStderr(): string {
    const out = this.stderrBuf;
    this.stderrBuf = '';
    return out;
  }

  /**
   * Peek at (do not reset) the captured stderr. Useful for debug
   * logging in test failure messages.
   */
  peekStderr(): string {
    return this.stderrBuf;
  }
}
