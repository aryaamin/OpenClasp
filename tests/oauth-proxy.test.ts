import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as authorizationMetadata } from '../api/oauth-authorization-server.js';
import { authorize } from '../api/oauth-authorize.js';
import { register } from '../api/oauth-register.js';
import type { OAuthStore, OAuthTransaction } from '../api/oauth-store.js';
import { exchange } from '../api/oauth-token.js';

afterEach(() => vi.restoreAllMocks());

describe('OpenClasp OAuth broker', () => {
  it('publishes OpenClasp-owned OAuth endpoints', async () => {
    const response = await authorizationMetadata(
      new Request('https://openclasp.example/.well-known/oauth-authorization-server'),
    );
    await expect(response.json()).resolves.toMatchObject({
      issuer: 'https://openclasp.example',
      authorization_endpoint: 'https://openclasp.example/oauth/authorize',
      token_endpoint: 'https://openclasp.example/oauth/token',
      registration_endpoint: 'https://openclasp.example/oauth/register',
      scopes_supported: expect.arrayContaining([
        'mcp:access',
        'profile:read',
        'interaction:write',
        'feedback:write',
        'agent:manage',
      ]),
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  it('registers public clients in OpenClasp instead of Auth0', async () => {
    const registerClient = vi.fn().mockResolvedValue({
      clientId: 'oc_client',
      redirectUris: ['http://localhost:8787/callback'],
    });
    const input = {
      client_name: 'MCP client',
      redirect_uris: ['http://localhost:8787/callback'],
      token_endpoint_auth_method: 'none',
    };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await register(
      new Request('https://openclasp.example/oauth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      { registerClient } as unknown as OAuthStore,
    );
    expect(response.status).toBe(201);
    expect(registerClient).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      client_id: 'oc_client',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it('rejects unsafe web redirect URIs', async () => {
    const registerClient = vi.fn();
    const response = await register(
      new Request('https://openclasp.example/oauth/register', {
        method: 'POST',
        body: JSON.stringify({ redirect_uris: ['http://attacker.example/callback'] }),
      }),
      { registerClient } as unknown as OAuthStore,
    );
    expect(response.status).toBe(400);
    expect(registerClient).not.toHaveBeenCalled();
  });

  it('brokers authorization through the existing Auth0 application', async () => {
    const createTransaction = vi.fn().mockResolvedValue(undefined);
    const store = {
      getClient: vi.fn().mockResolvedValue({
        clientId: 'oc_client',
        redirectUris: ['http://127.0.0.1:4567/callback'],
      }),
      createTransaction,
    } as unknown as OAuthStore;
    const challenge = createHash('sha256').update('downstream-verifier').digest('base64url');
    const request = new Request(
      `https://openclasp.example/oauth/authorize?${new URLSearchParams({
        client_id: 'oc_client',
        redirect_uri: 'http://127.0.0.1:4567/callback',
        response_type: 'code',
        scope: 'mcp:access profile:read interaction:write',
        state: 'client-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
    );
    const response = await authorize(request, store);
    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get('location')!);
    expect(destination.origin).toBe('https://icfg-0ua6bab8d4omtfolx72mrhzo.us.auth0.com');
    expect(destination.searchParams.get('client_id')).toBe('vGxzZd4LiO7TqH4U61QblwH96YcimpcA');
    expect(destination.searchParams.get('redirect_uri')).toBe(
      'https://openclasp.vercel.app/sso-callback',
    );
    const saved = createTransaction.mock.calls[0]?.[0] as OAuthTransaction;
    expect(saved.clientId).toBe('oc_client');
    expect(saved.downstreamState).toBe('client-state');
    expect(saved.codeChallenge).toBe(challenge);
    expect(saved.scope).toBe('mcp:access profile:read interaction:write');
  });

  it('does not let integration credentials opt an account into network contribution', async () => {
    const store = {
      getClient: vi.fn().mockResolvedValue({
        clientId: 'oc_client',
        redirectUris: ['http://127.0.0.1:4567/callback'],
      }),
      createTransaction: vi.fn(),
    } as unknown as OAuthStore;
    const response = await authorize(
      new Request(
        `https://openclasp.example/oauth/authorize?${new URLSearchParams({
          client_id: 'oc_client',
          redirect_uri: 'http://127.0.0.1:4567/callback',
          response_type: 'code',
          scope: 'mcp:access network:contribute',
          code_challenge: 'challenge',
          code_challenge_method: 'S256',
        })}`,
      ),
      store,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_scope' });
    expect(store.createTransaction).not.toHaveBeenCalled();
  });

  it('exchanges a PKCE code for OpenClasp opaque tokens', async () => {
    const verifier = 'a-secure-downstream-verifier';
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const issueTokens = vi.fn().mockResolvedValue({
      accessToken: 'oc_oat_access',
      refreshToken: 'oc_rt_refresh',
      expiresIn: 3600,
    });
    const store = {
      takeAuthorizationCode: vi.fn().mockResolvedValue({
        clientId: 'oc_client',
        operatorId: 'auth0|user',
        redirectUri: 'http://localhost:8787/callback',
        scope: 'mcp:access',
        codeChallenge,
      }),
      issueTokens,
    } as unknown as OAuthStore;
    const response = await exchange(
      new Request('https://openclasp.example/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'oc_client',
          code: 'oc_code_value',
          redirect_uri: 'http://localhost:8787/callback',
          code_verifier: verifier,
        }),
      }),
      store,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: 'oc_oat_access',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'oc_rt_refresh',
      scope: 'mcp:access',
    });
    expect(issueTokens).toHaveBeenCalledWith('oc_client', 'auth0|user', ['mcp:access']);
  });

  it('rejects an incorrect PKCE verifier', async () => {
    const issueTokens = vi.fn();
    const store = {
      takeAuthorizationCode: vi.fn().mockResolvedValue({
        clientId: 'oc_client',
        operatorId: 'auth0|user',
        redirectUri: 'http://localhost:8787/callback',
        scope: 'mcp:access',
        codeChallenge: createHash('sha256').update('correct-verifier').digest('base64url'),
      }),
      issueTokens,
    } as unknown as OAuthStore;
    const response = await exchange(
      new Request('https://openclasp.example/oauth/token', {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'oc_client',
          code: 'oc_code_value',
          redirect_uri: 'http://localhost:8787/callback',
          code_verifier: 'wrong-verifier',
        }),
      }),
      store,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_grant' });
    expect(issueTokens).not.toHaveBeenCalled();
  });
});
