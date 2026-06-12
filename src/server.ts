/**
 * `createServer()` wires the four MCP tools DiagramForge exposes.
 *
 * The server is the only place that knows about the MCP SDK; downstream
 * code is built against the pure tool-handler functions so they can be
 * unit-tested without a transport.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListDiagramTypesTool } from './tools/list-diagram-types.js';
import { registerMakeDiagramTool } from './tools/make-diagram.js';
import { registerParseSpecTool } from './tools/parse-spec.js';
import { registerRenderDiagramTool } from './tools/render-diagram.js';

const SERVER_NAME = 'diagramforge';
const SERVER_VERSION = '0.1.0';

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerListDiagramTypesTool(server);
  registerParseSpecTool(server);
  registerRenderDiagramTool(server);
  registerMakeDiagramTool(server);
  return server;
}
