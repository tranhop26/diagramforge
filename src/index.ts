#!/usr/bin/env node
/**
 * DiagramForge MCP stdio server entry point.
 *
 * Wires `createServer()` to a `StdioServerTransport`. All log output goes
 * to stderr; stdout is reserved for the MCP channel.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

process.on('uncaughtException', (err) => {
  process.stderr.write(
    `[diagramforge] uncaught exception: ${err.stack ?? err.message}\n`,
  );
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(
    `[diagramforge] unhandled rejection: ${
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    }\n`,
  );
});

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[diagramforge] stdio server ready\n');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[diagramforge] fatal: ${msg}\n`);
  process.exit(1);
});
