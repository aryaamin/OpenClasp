import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as authorizationMetadata } from '../api/oauth-authorization-server.js';
import { POST as registerClient } from '../api/oauth-register.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hosted OAuth compatibility proxy', () => {
  it('publishes OpenClasp discovery with Auth0 endpoints and the MCP audience', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          issuer: 'https://tenant.auth0.com/',
          authorization_endpoint: 'https://tenant.auth0.com/authorize',
          token_endpoint: 'https://tenant.auth0.com/oauth/token',
          registration_endpoint: 'https://tenant.auth0.com/oidc/register',
          response_types_supported: ['code'],
        }),
      ),
    );

    const response = await authorizationMetadata(
      new Request('https://openclasp.example/.well-known/oauth-authorization-server'),
    );
    const metadata = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(metadata).toMatchObject({
      issuer: 'https://openclasp.example',
      registration_endpoint: 'https://openclasp.example/oauth/register',
      scopes_supported: ['mcp:access'],
    });
    expect(String(metadata.authorization_endpoint)).toContain(
      'audience=https%3A%2F%2Fopenclasp.vercel.app%2Fmcp',
    );
  });

  it('forwards dynamic client registration without exposing credentials', async () => {
    const upstream = vi.fn().mockResolvedValue(
      Response.json(
        {
          client_id: 'tpc_test',
          redirect_uris: ['http://localhost:8787/callback'],
          token_endpoint_auth_method: 'none',
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const input = {
      client_name: 'MCP client',
      redirect_uris: ['http://localhost:8787/callback'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp:access',
    };

    const response = await registerClient(
      new Request('https://openclasp.example/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledOnce();
    expect(upstream.mock.calls[0]?.[0]).toBe(
      'https://icfg-0ua6bab8d4omtfolx72mrhzo.us.auth0.com/oidc/register',
    );
    expect(JSON.parse(String(upstream.mock.calls[0]?.[1]?.body))).toEqual(input);
  });
});
