import { describe, expect, it } from 'vitest';
import { POST as mcpHandler } from '../api/mcp.js';
import { GET as metadataHandler } from '../api/oauth-protected-resource.js';
import { dashboardTokenFromCookie } from '../api/auth0.js';

describe('hosted MCP authorization', () => {
  it('reads only the named dashboard session cookie', () => {
    expect(dashboardTokenFromCookie('other=x; openclasp_session=token%2Evalue; last=y')).toBe(
      'token.value',
    );
    expect(dashboardTokenFromCookie('other=x')).toBeUndefined();
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
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://openclasp.example/.well-known/oauth-protected-resource/mcp", scope="mcp:access"',
    );
    expect(response.headers.get('www-authenticate')).not.toContain('invalid_token');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('publishes Auth0 protected-resource metadata', async () => {
    const response = metadataHandler(
      new Request('https://openclasp.example/.well-known/oauth-protected-resource'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: 'https://openclasp.example/mcp',
      authorization_servers: ['https://openclasp.example'],
      scopes_supported: ['mcp:access'],
    });
  });
});
