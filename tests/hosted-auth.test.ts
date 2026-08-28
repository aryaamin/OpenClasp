import { afterEach, describe, expect, it } from 'vitest';
import { POST as mcpHandler } from '../api/mcp.js';
import { GET as metadataHandler } from '../api/oauth-protected-resource.js';

describe('hosted MCP authorization', () => {
  const originalPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  afterEach(() => {
    if (originalPublishableKey === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPublishableKey;
  });

  it('challenges unauthenticated remote MCP requests', async () => {
    const response = await mcpHandler(
      new Request('https://openclasp.example/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://openclasp.example/.well-known/oauth-protected-resource"',
    );
  });

  it('fails closed when the OAuth issuer is not configured', () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const response = metadataHandler(
      new Request('https://openclasp.example/.well-known/oauth-protected-resource'),
    );
    expect(response.status).toBe(503);
  });
});
