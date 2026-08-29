import { describe, expect, it, vi } from 'vitest';
import { canonicalHash, type LiveSessionActivation } from '../packages/protocol/src/index.js';
import {
  getSessionVerificationKey,
  issueSessionGrant,
  signSessionControl,
} from '../packages/persistence/src/relay.js';
import { resolvePublicRuntimeEndpoint } from '../packages/persistence/src/runtime.js';
import {
  createAgentRuntimeConnector,
  createOpenClaspRuntimeHandler,
  MemoryRuntimeSessionStore,
  OpenClaspClient,
} from '../packages/sdk/src/index.js';

describe('direct live agent runtime connector', () => {
  const platformSecret = 'platform-secret-long-enough-for-testing';
  const interactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sessions = new Map<string, LiveSessionActivation>();
  const onMessage = vi.fn(async () => ({ text: 'hello back' }));
  const handler = createOpenClaspRuntimeHandler({
    agentId: 'agent-b',
    a2aEndpoint: 'https://agent-b.example/a2a',
    openClaspVerificationKey: getSessionVerificationKey(platformSecret),
    onSessionOffer: () => ({
      accepted: true,
      sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    }),
    onSessionActivated(session) {
      sessions.set(session.interactionId, session);
    },
    loadSession: async (id) => sessions.get(id),
    onMessage,
  });

  it('verifies endpoint ownership and advertises the direct A2A endpoint', async () => {
    const response = await handler(
      new Request('https://agent-b.example/openclasp', {
        method: 'POST',
        body: JSON.stringify({
          type: 'openclasp.runtime.verify',
          version: '1',
          agentId: 'agent-b',
          challenge: 'challenge-1',
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      type: 'openclasp.runtime.verified',
      version: '1',
      agentId: 'agent-b',
      challenge: 'challenge-1',
      a2aEndpoint: 'https://agent-b.example/a2a',
    });
  });

  it('prepares and activates a signed live session, then accepts direct A2A', async () => {
    const now = new Date();
    const contract = {
      protocolVersion: '0.1' as const,
      interactionId,
      purpose: 'Coordinate research',
      parties: ['agent-a', 'agent-b'],
      taskCategory: 'research',
      requestedOutcome: 'Return sources',
      successCriteria: ['Sources returned'],
      allowedActions: [],
      prohibitedActions: [],
      allowedData: [],
      prohibitedData: [],
      evidenceRequirements: [],
      delegationRules: [],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent' as const,
      retentionDays: 30,
      completionConditions: ['Sources returned'],
      cancellationConditions: [],
      signatures: {},
    };
    const offer = {
      type: 'openclasp.session.offer' as const,
      version: '1' as const,
      offerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      interactionId,
      agentId: 'agent-b',
      role: 'responder' as const,
      counterparty: {
        agentId: 'agent-a',
        name: 'Agent A',
        agentVersion: '1.0.0',
        capabilities: ['research'],
      },
      contract,
      contractHash: canonicalHash(contract),
      privateInsights: [],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    };
    const offerBody = JSON.stringify(offer);
    const offerTimestamp = now.toISOString();
    const accepted = await handler(
      new Request('https://agent-b.example/openclasp', {
        method: 'POST',
        headers: {
          'openclasp-request-id': offer.offerId,
          'openclasp-timestamp': offerTimestamp,
          'openclasp-signature': `v1=${signSessionControl(platformSecret, offer.offerId, offerTimestamp, offerBody)}`,
        },
        body: offerBody,
      }),
    );
    expect(accepted.status).toBe(200);
    const acceptance = (await accepted.json()) as { sessionId: string };

    const credential = issueSessionGrant(platformSecret, {
      interactionId,
      senderAgentId: 'agent-b',
      recipientAgentId: 'agent-a',
      expiresAt: now.getTime() + 60_000,
    });
    const activation: LiveSessionActivation = {
      type: 'openclasp.session.activation',
      version: '1',
      activationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      interactionId,
      agentId: 'agent-b',
      sessionId: acceptance.sessionId,
      role: 'responder',
      peer: {
        agentId: 'agent-a',
        sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        endpoint: 'https://agent-a.example/a2a',
        bearerToken: credential,
        verificationKey: getSessionVerificationKey(platformSecret),
      },
      reporting: {
        endpoint: `https://openclasp.vercel.app/sessions/${interactionId}/events`,
        bearerToken: credential,
      },
      contractHash: offer.contractHash,
      activatedAt: now.toISOString(),
      expiresAt: offer.expiresAt,
    };
    const activationBody = JSON.stringify(activation);
    const activationTimestamp = new Date().toISOString();
    const activated = await handler(
      new Request('https://agent-b.example/openclasp', {
        method: 'POST',
        headers: {
          'openclasp-request-id': activation.activationId,
          'openclasp-timestamp': activationTimestamp,
          'openclasp-signature': `v1=${signSessionControl(platformSecret, activation.activationId, activationTimestamp, activationBody)}`,
        },
        body: activationBody,
      }),
    );
    expect(activated.status).toBe(200);

    const inboundCredential = issueSessionGrant(platformSecret, {
      interactionId,
      senderAgentId: 'agent-a',
      recipientAgentId: 'agent-b',
      expiresAt: Date.now() + 60_000,
    });
    const direct = await handler(
      new Request('https://agent-b.example/a2a', {
        method: 'POST',
        headers: { authorization: `Bearer ${inboundCredential}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'turn-1',
          method: 'message/send',
          params: { message: { parts: [{ kind: 'text', text: 'hello' }] } },
        }),
      }),
    );
    expect(direct.status).toBe(200);
    await expect(direct.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'turn-1',
      result: { text: 'hello back' },
    });
    expect(onMessage).toHaveBeenCalledOnce();
  });
});

it('adapts a provider runtime and persists activation before delivering messages', async () => {
  const sessions = new MemoryRuntimeSessionStore();
  const calls: string[] = [];
  const handler = createAgentRuntimeConnector({
    agentId: 'agent-provider',
    a2aEndpoint: 'https://provider.example/a2a',
    openClaspVerificationKey: getSessionVerificationKey('provider-test-secret'),
    sessions,
    adapter: {
      name: 'test-provider',
      prepareSession: () => ({ accepted: true }),
      activateSession: async (session) => {
        calls.push(`activate:${session.interactionId}`);
        expect(await sessions.get(session.interactionId)).toEqual(session);
      },
      receiveMessage: ({ requestId }) => ({ task: { id: String(requestId), state: 'submitted' } }),
    },
  });
  const verified = await handler(
    new Request('https://provider.example/a2a', {
      method: 'POST',
      body: JSON.stringify({
        type: 'openclasp.runtime.verify',
        version: '1',
        agentId: 'agent-provider',
        challenge: 'provider-challenge',
      }),
    }),
  );
  expect(verified.status).toBe(200);
  await expect(verified.json()).resolves.toMatchObject({
    type: 'openclasp.runtime.verified',
    agentId: 'agent-provider',
    a2aEndpoint: 'https://provider.example/a2a',
  });
  expect(calls).toEqual([]);
});

it('uses an agent token for bodyless runtime heartbeats without a JSON content header', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oc_at_test');
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
    return Response.json({ status: 'online', checkedAt: new Date().toISOString() });
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    await new OpenClaspClient('https://openclasp.example/v0.1', 'oc_at_test').heartbeatRuntime();
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('rejects local and non-HTTPS runtime targets before connecting', async () => {
  await expect(resolvePublicRuntimeEndpoint('http://example.com/runtime')).rejects.toThrow('HTTPS');
  await expect(resolvePublicRuntimeEndpoint('https://localhost/runtime')).rejects.toThrow(
    'public DNS',
  );
  await expect(resolvePublicRuntimeEndpoint('https://127.0.0.1/runtime')).rejects.toThrow(
    'public DNS',
  );
});
