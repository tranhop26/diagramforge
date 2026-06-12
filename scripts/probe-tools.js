#!/usr/bin/env node
/**
 * stdio smoke test for the built `dist/index.js` server.
 *
 * Spawns the server, exchanges the JSON-RPC `initialize` + `tools/list`
 * handshake, asserts the four exact tool names, prints the names as a
 * JSON array on stdout, and exits 0 on success / 1 on failure.
 *
 * Usage: `node scripts/probe-tools.js`
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'list_diagram_types',
  'parse_spec',
  'render_diagram',
  'make_diagram',
];

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'diagramforge-probe', version: '0.0.1' };
const TIMEOUT_MS = 10_000;

function send(proc, message) {
  proc.stdin.write(JSON.stringify(message) + '\n');
}

const proc = spawn(process.execPath, [SERVER_PATH], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
});

let stdoutBuf = '';
let stderrBuf = '';
let initialized = false;
let finished = false;

function done(code, reason) {
  if (finished) return;
  finished = true;
  if (reason) process.stderr.write(`[probe] ${reason}\n`);
  if (stderrBuf) process.stderr.write(`[probe] server stderr:\n${stderrBuf}\n`);
  proc.kill();
  process.exit(code);
}

proc.stdout.setEncoding('utf8');
proc.stdout.on('data', (chunk) => {
  stdoutBuf += chunk;
  let nl;
  while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_err) {
      process.stderr.write(`[probe] non-JSON line on stdout: ${line}\n`);
      continue;
    }
    handle(msg);
  }
});

proc.stderr.setEncoding('utf8');
proc.stderr.on('data', (chunk) => {
  stderrBuf += chunk;
});

proc.on('exit', (code, signal) => {
  if (!finished) {
    process.stderr.write(
      `[probe] server exited (code=${code} signal=${signal}) before completion\n`,
    );
    done(1);
  }
});

setTimeout(() => {
  done(1, `timeout after ${TIMEOUT_MS}ms`);
}, TIMEOUT_MS);

function handle(msg) {
  if (msg.error) {
    process.stderr.write(
      `[probe] server returned error: ${JSON.stringify(msg.error)}\n`,
    );
    done(1);
    return;
  }
  if (!initialized && msg.id === 1 && msg.result) {
    initialized = true;
    send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
    send(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    return;
  }
  if (initialized && msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) {
    const names = msg.result.tools.map((t) => t.name);
    const sorted = [...names].sort();
    const expected = [...EXPECTED_TOOLS].sort();
    if (
      names.length !== EXPECTED_TOOLS.length ||
      sorted.join('|') !== expected.join('|')
    ) {
      process.stderr.write(
        `[probe] tool list mismatch. expected=${JSON.stringify(EXPECTED_TOOLS)} got=${JSON.stringify(names)}\n`,
      );
      done(1, 'tool list mismatch');
      return;
    }
    process.stdout.write(JSON.stringify(names) + '\n');
    done(0);
  }
}

send(proc, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  },
});
