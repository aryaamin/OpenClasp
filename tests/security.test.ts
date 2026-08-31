import { describe, expect, it } from 'vitest';
import {
  ScopeError,
  assertScopes,
  requiredAgentApiScopes,
  requiredMcpRequestScopes,
  requiredMcpToolScope,
} from '../apps/api/src/access-control.js';
import { productionConfigurationErrors } from '../apps/api/src/production-config.js';
import { guardRequest } from '../apps/api/src/request-security.js';
import { buildApi } from '../apps/api/src/app.js';
import { FixedWindowRateLimiter } from '../apps/api/src/security.js';
import { UnavailableFactCheckProvider } from '../packages/core/src/index.js';

describe('production security boundaries', () => {
  it('maps agent and MCP actions to least-privilege scopes', async () => {
    expect(requiredMcpToolScope('openclasp_get_profile')).toBe('profile:read');
    expect(requiredMcpToolScope('openclasp_connect_to_agent')).toBe('interaction:write');
    expect(requiredMcpToolScope('openclasp_submit_interaction_feedback')).toBe('feedback:write');
    expect(requiredMcpToolScope('openclasp_update_profile')).toBe('agent:manage');
    expect(
      await requiredMcpRequestScopes(
        new Request('https://openclasp.example/mcp', {
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'openclasp_connect_to_agent', arguments: {} },
          }),
        }),
      ),
    ).toEqual(['mcp:access', 'interaction:write']);
    expect(
      requiredAgentApiScopes(
        'POST',
        '/v0.1/federated-interactions/11111111-1111-4111-8111-111111111111/feedback',
      ),
    ).toEqual(['feedback:write']);
    expect(requiredAgentApiScopes('GET', '/v0.1/dashboard')).toBeUndefined();
    expect(() => assertScopes(['mcp:access'], ['interaction:write'])).toThrow(ScopeError);
  });

  it('rate limits and rejects oversized function requests', async () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.consume('operator:one', 1, 60_000, 1).allowed).toBe(true);
    expect(limiter.consume('operator:one', 1, 60_000, 2).allowed).toBe(false);
    const request = new Request('https://openclasp.example/oauth/token', {
      method: 'POST',
      headers: { 'x-real-ip': '192.0.2.44' },
      body: 'x'.repeat(33),
    });
    expect(
      await guardRequest(request, 'security-test-payload', { limit: 10, maximumBytes: 32 }),
    ).toMatchObject({ status: 413 });
  });

  it('fails closed on incomplete production configuration', () => {
    const errors = productionConfigurationErrors('api', {
      NODE_ENV: 'production',
      OPENCLASP_PUBLIC_URL: 'http://openclasp.example',
      OPENCLASP_RELAY_ENCRYPTION_KEY: 'short',
    });
    expect(errors).toContain('DATABASE_URL is required');
    expect(errors).toContain('AUTH0_DOMAIN is required');
    expect(errors).toContain('OPENCLASP_PUBLIC_URL must use HTTPS');
    expect(errors).toContain('OPENCLASP_RELAY_ENCRYPTION_KEY must contain at least 32 characters');
  });

  it('requires the unforgeable internal auth boundary for hosted account data', async () => {
    const repository = {
      dashboard: async (operatorId: string) => ({ operatorId }),
    } as any;
    const app = buildApi(undefined, undefined, repository, {
      internalAuthSecret: 'internal-secret',
    });
    await app.ready();
    const spoofed = await app.inject({
      method: 'GET',
      url: '/v0.1/dashboard',
      headers: { 'x-openclasp-operator': 'victim' },
    });
    expect(spoofed.statusCode).toBe(401);
    const trusted = await app.inject({
      method: 'GET',
      url: '/v0.1/dashboard',
      headers: {
        'x-openclasp-operator': 'owner',
        'x-openclasp-internal-auth': 'internal-secret',
      },
    });
    expect(trusted.statusCode).toBe(200);
    expect(trusted.json()).toEqual({ operatorId: 'owner' });
    await app.close();
  });

  it('returns unknown instead of fixture-backed claims when no provider is configured', async () => {
    await expect(
      new UnavailableFactCheckProvider().check('The moon is cheese'),
    ).resolves.toMatchObject({
      status: 'unverified',
      confidence: 0,
      evidenceReferences: [],
    });
  });
});
