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
    expect(
      (await app.inject({ method: 'GET', url: '/extensions/trust/v0.1' })).json(),
    ).toMatchObject({ version: '0.1', transportsMessages: true });
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
          federatedInteractions: [],
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
          rawConversationsStored: true as const,
        };
      },
      saveSettings: async (operatorId: string, value: any) => {
        calls.push(`save:${operatorId}`);
        return { ...value, rawConversationsStored: true as const };
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
            description: 'Finds primary sources',
            framework: 'Codex',
            agentVersion: '1.0.0',
            a2aEndpoint: 'https://agent.example/a2a',
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
      getPublishedAgent: async () => published[0],
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
    const publicCard = await app.inject({
      method: 'GET',
      url: '/agents/agent-one/card.json',
    });
    expect(publicCard.statusCode).toBe(200);
    expect(publicCard.json()).not.toHaveProperty('projectId');
    const a2aCard = await app.inject({
      method: 'GET',
      url: '/agents/agent-one/a2a-agent-card.json',
    });
    expect(a2aCard.statusCode).toBe(200);
    expect(a2aCard.json().supportedInterfaces[0]).toMatchObject({
      url: 'https://localhost:80/a2a/agent-one',
      protocolVersion: '1.0',
    });
    const automation = await app.inject({
      method: 'PUT',
      url: '/v0.1/agents/agent-one/automation',
      headers: { 'x-openclasp-operator': 'owner-one' },
      payload: {
        a2aEndpoint: 'https://agent.example/a2a',
        autoPublish: true,
        autoAcceptPolicy: 'safe_matching',
        autoAcceptTaskCategories: ['research'],
      },
    });
    expect(automation.statusCode).toBe(200);
    expect(automation.json()).toMatchObject({
      autoPublish: true,
      autoAcceptPolicy: 'safe_matching',
    });
    await app.close();
  });

  it('accepts scoped A2A JSON-RPC delivery at the hosted endpoint', async () => {
    const queued: any[] = [];
    const repository = {
      dashboard: async () => ({}) as any,
      getSettings: async () => ({}) as any,
      saveSettings: async () => ({}) as any,
      upsert: async () => undefined,
      list: async () => [],
      publishAgent: async (_operatorId: string, card: any) => card,
      unpublishAgent: async () => true,
      getPublishedAgent: async () => undefined,
      searchPublishedAgents: async () => [],
      verifyGatewayToken: () => ({
        interactionId: 'interaction-1',
        senderAgentId: 'agent-a',
        recipientAgentId: 'agent-b',
        expiresAt: Date.now() + 60_000,
      }),
      enqueueGatewayMessage: async (value: any) => {
        queued.push(value);
        return {
          accepted: true,
          deduplicated: false,
          messageId: 'message-1',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    expect((await app.inject({ method: 'POST', url: '/a2a/agent-b' })).statusCode).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/a2a/agent-b',
      headers: { authorization: 'Bearer scoped-token' },
      payload: {
        jsonrpc: '2.0',
        id: 'request-1',
        method: 'message/send',
        params: { message: { role: 'user', parts: [{ kind: 'text', text: 'hello' }] } },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ jsonrpc: '2.0', id: 'request-1' });
    expect(queued[0]).toMatchObject({
      interactionId: 'interaction-1',
      senderAgentId: 'agent-a',
      recipientAgentId: 'agent-b',
      idempotencyKey: 'a2a:interaction-1:request-1',
    });
    await app.close();
  });
});
