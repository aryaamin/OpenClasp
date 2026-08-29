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
    ).toMatchObject({ version: '0.1', transportsMessages: false });
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
          liveSessions: [],
          hostedThreads: [],
          events: [],
          conflicts: [],
          receipts: [],
          profiles: [],
          runtimes: [],
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
      registerAgentRuntime: async (operatorId: string, agentId: string, endpoint: string) => {
        calls.push(`runtime:${operatorId}:${agentId}:${endpoint}`);
        return {
          agentId,
          endpoint,
          a2aEndpoint: endpoint,
          status: 'verified' as const,
          verifiedAt: new Date().toISOString(),
          verificationKey: 'public-key',
        };
      },
      disableAgentRuntime: async (operatorId: string, agentId: string) => {
        calls.push(`disable-runtime:${operatorId}:${agentId}`);
        return { agentId, status: 'disabled' as const };
      },
      deleteAgent: async (operatorId: string, agentId: string) => {
        calls.push(`delete-agent:${operatorId}:${agentId}`);
        return { agentId, deleted: true as const, historyRetained: true as const };
      },
      receiveTemporaryMessage: async (
        token: string,
        agentId: string,
        requestKey: string,
        content: string,
      ) => {
        calls.push(`temporary:${token}:${agentId}:${requestKey}:${content}`);
        return {
          message: {
            messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            interactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            senderAgentId: 'agent-peer',
            recipientAgentId: agentId,
            contentType: 'text/plain' as const,
            content,
            contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            delivery: 'delivered' as const,
            createdAt: new Date().toISOString(),
          },
          deduplicated: false,
        };
      },
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
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v0.1/agents/agent-a/runtime',
          headers: { 'x-openclasp-operator': 'user-a' },
          payload: { endpoint: 'https://agent.example/openclasp' },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls).toEqual([
      'dashboard:user-a',
      'settings:user-b',
      'runtime:user-a:agent-a:https://agent.example/openclasp',
    ]);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v0.1/agents/agent-a',
          headers: { 'x-openclasp-operator': 'user-a' },
        })
      ).json(),
    ).toMatchObject({ agentId: 'agent-a', deleted: true, historyRetained: true });
    expect(calls.at(-1)).toBe('delete-agent:user-a:agent-a');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/a2a/temporary/agent-a',
          payload: {
            jsonrpc: '2.0',
            id: 'request-1',
            method: 'message/send',
            params: { message: { parts: [{ kind: 'text', text: 'Hello engineer' }] } },
          },
        })
      ).statusCode,
    ).toBe(401);
    const temporaryDelivery = await app.inject({
      method: 'POST',
      url: '/a2a/temporary/agent-a',
      headers: { authorization: 'Bearer scoped-token' },
      payload: {
        jsonrpc: '2.0',
        id: 'request-1',
        method: 'message/send',
        params: { message: { parts: [{ kind: 'text', text: 'Hello engineer' }] } },
      },
    });
    expect(temporaryDelivery.statusCode).toBe(200);
    expect(temporaryDelivery.json()).toMatchObject({
      result: {
        task: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'submitted' },
        privacyMode: 'openclasp_hosted_temporary',
      },
    });
    expect(calls.at(-1)).toBe('temporary:scoped-token:agent-a:request-1:Hello engineer');
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
      url: 'https://agent.example/a2a',
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

  it('accepts only structured live-session events at the reporting endpoint', async () => {
    const events: any[] = [];
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
      recordLiveSessionEvent: async (token: string, value: any) => {
        events.push({ token, value });
        return {
          recorded: true,
          deduplicated: false,
          eventId: value.eventId,
          attestation: {
            algorithm: 'Ed25519' as const,
            keyId: 'openclasp:test',
            value: 'signature',
            digest: 'digest',
          },
        };
      },
    };
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    const interactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(
      (await app.inject({ method: 'POST', url: `/sessions/${interactionId}/events` })).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${interactionId}/events`,
      headers: { authorization: 'Bearer live-session-token' },
      payload: {
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        interactionId,
        agentId: 'agent-a',
        sequence: 1,
        type: 'message_sent',
        occurredAt: new Date().toISOString(),
        messageHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        evidenceReferences: [],
        details: {},
      },
    });
    expect(response.statusCode).toBe(200);
    expect(events[0]).toMatchObject({
      token: 'live-session-token',
      value: { interactionId, agentId: 'agent-a', type: 'message_sent' },
    });
    const rawMessageAttempt = await app.inject({
      method: 'POST',
      url: `/sessions/${interactionId}/events`,
      headers: { authorization: 'Bearer live-session-token' },
      payload: {
        eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        interactionId,
        agentId: 'agent-a',
        sequence: 2,
        type: 'message_sent',
        occurredAt: new Date().toISOString(),
        details: { message: 'raw conversation text' },
      },
    });
    expect(rawMessageAttempt.statusCode).toBe(400);
    expect(events).toHaveLength(1);
    await app.close();
  });
});
