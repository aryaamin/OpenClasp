import { describe, expect, it } from 'vitest';
import { buildApi } from '../apps/api/src/app.js';

describe('HTTP API', () => {
  it('serves health, readiness, and OpenAPI', async () => {
    const app = buildApi();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({
      status: 'ready',
    });
    const specification = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    expect(specification.info.title).toBe('OpenClasp API');
    expect(specification.paths).toHaveProperty('/v0.1/risk/assess');
    await app.close();
  });

  it('isolates hosted dashboard and settings by authenticated operator', async () => {
    const calls: string[] = [];
    const repository = {
      dashboard: async (operatorId: string) => {
        calls.push(`dashboard:${operatorId}`);
        return {
          agents: [],
          projects: [],
          installations: [],
          setupRequests: [],
          interactions: [],
          events: [],
          conflicts: [],
          receipts: [],
          profiles: [],
        };
      },
      getSettings: async (operatorId: string) => {
        calls.push(`settings:${operatorId}`);
        return {
          displayName: '',
          contributionEnabled: false,
          retentionDays: 30,
          evidenceSharing: 'ask' as const,
          rawConversationsStored: false as const,
        };
      },
      saveSettings: async (operatorId: string, value: any) => {
        calls.push(`save:${operatorId}`);
        return { ...value, rawConversationsStored: false as const };
      },
      upsert: async () => undefined,
      list: async () => [],
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/v0.1/dashboard' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/dashboard',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v0.1/settings',
          headers: { 'x-openclasp-operator': 'user-b' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls).toEqual(['dashboard:user-a', 'settings:user-b']);
    await app.close();
  });
});
