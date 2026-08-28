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
          publications: [],
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
      publishAgent: async (_operatorId: string, card: any) => card,
      unpublishAgent: async () => true,
      getPublishedAgent: async () => undefined,
      searchPublishedAgents: async () => [],
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

  it('publishes only an owned agent public card', async () => {
    const published: any[] = [];
    const repository = {
      dashboard: async () => ({}) as any,
      getSettings: async () => ({}) as any,
      saveSettings: async () => ({}) as any,
      upsert: async () => undefined,
      list: async () => [
        {
          kind: 'agent_profile' as const,
          recordId: 'agent-one',
          payload: {
            agentId: 'agent-one',
            projectId: 'secret-project',
            name: 'Research agent',
            framework: 'Codex',
            capabilities: ['research'],
            limitations: ['no purchases'],
            identityMode: 'oauth_installation' as const,
            status: 'active' as const,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      publishAgent: async (_operatorId: string, card: any) => {
        published.push(card);
        return card;
      },
      unpublishAgent: async () => true,
      getPublishedAgent: async () => undefined,
      searchPublishedAgents: async () => published,
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/v0.1/agents/agent-one/publication',
      headers: { 'x-openclasp-operator': 'owner-one' },
      payload: { published: true },
    });
    expect(response.statusCode).toBe(200);
    expect(published[0]).toMatchObject({
      agentId: 'agent-one',
      capabilities: ['research'],
      assurance: 'oauth_authenticated',
    });
    expect(published[0]).not.toHaveProperty('projectId');
    expect(published[0]).not.toHaveProperty('operatorId');
    await app.close();
  });
});
