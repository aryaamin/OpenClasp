import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildMcpServer } from './server.js';

const handle = serveStdio(() => buildMcpServer());
console.error('OpenClasp MCP server listening on stdio');
process.on('SIGINT', () => void handle.close());
