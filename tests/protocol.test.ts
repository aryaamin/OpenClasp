import { describe, expect, it } from 'vitest';
import { createIdentity, TrustEngine } from '@openclasp/core';
import {
  FederatedInteractionSchema,
  HostedMessageSchema,
  HostedThreadSchema,
  PublicAgentCardSchema,
  canonicalHash,
  signObject,
  verifyObject,
} from '@openclasp/protocol';
import { toA2AAgentCard } from '@openclasp/sidecar';

describe('protocol cryptography and delegation', () => {
  it('canonicalizes object key order and rejects tampering', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    const agent = createIdentity({
      agentId: 'agent:a',
      operatorRef: 'operator:a',
      capabilities: ['write'],
    });
    const signed = signObject({ action: 'write', value: 1 }, agent.keyPair);
    expect(verifyObject(signed, agent.identity.publicKey)).toBe(true);
    expect(verifyObject({ ...signed, value: 2 }, agent.identity.publicKey)).toBe(false);
  });

  it('prevents authority escalation and rejects expired delegation', () => {
    const engine = new TrustEngine();
    const parent = createIdentity({
      agentId: 'agent:parent',
      operatorRef: 'operator:x',
      capabilities: ['read'],
    });
    const child = createIdentity({
      agentId: 'agent:child',
      operatorRef: 'operator:x',
      capabilities: ['read'],
      parentAgentId: parent.identity.agentId,
      rootControllerId: parent.identity.rootControllerId,
    });
    engine.registerAgent(parent.identity);
    engine.registerAgent(child.identity);
    expect(() =>
      engine.createDelegation(
        parent.identity.agentId,
        child.identity.agentId,
        ['write'],
        new Date(Date.now() + 1000).toISOString(),
        parent.keyPair,
      ),
    ).toThrow('exceeds parent authority');
    const expired = engine.createDelegation(
      parent.identity.agentId,
      child.identity.agentId,
      ['read'],
      new Date(Date.now() - 1).toISOString(),
      parent.keyPair,
    );
    expect(engine.verifyDelegation(expired.delegationId)).toBe(false);
  });

  it('publishes an internet Agent Card and official A2A extension without private owner data', () => {
    const card = PublicAgentCardSchema.parse({
      protocolVersion: '0.1',
      agentId: 'agent:research',
      name: 'Research agent',
      description: 'Finds primary sources',
      framework: 'Codex',
      agentVersion: '1.2.0',
      capabilities: ['research'],
      limitations: ['no purchases'],
      assurance: 'oauth_authenticated',
      transports: [
        {
          protocol: 'A2A/1.0',
          protocolBinding: 'JSONRPC',
          endpoint: 'https://agent.example/a2a',
        },
      ],
      cardUrl: 'https://openclasp.vercel.app/agents/agent%3Aresearch/card.json',
      a2aAgentCardUrl: 'https://openclasp.vercel.app/agents/agent%3Aresearch/a2a-agent-card.json',
      extensionUri: 'https://openclasp.vercel.app/extensions/trust/v0.1',
      publishedAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    expect(card).not.toHaveProperty('operatorId');
    expect(card).not.toHaveProperty('projectId');
    const a2a = toA2AAgentCard(card);
    expect(a2a.supportedInterfaces[0]).toMatchObject({
      url: 'https://agent.example/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    });
    expect(a2a.capabilities?.extensions?.[0]?.uri).toBe(card.extensionUri);
  });

  it('binds bilateral acceptances to one immutable contract hash', () => {
    const interactionId = crypto.randomUUID();
    const contract = {
      protocolVersion: '0.1' as const,
      interactionId,
      purpose: 'Research a market',
      parties: ['agent:a', 'agent:b'],
      taskCategory: 'research',
      requestedOutcome: 'A sourced brief',
      successCriteria: ['Primary sources included'],
      allowedActions: ['browse'],
      prohibitedActions: ['purchase'],
      allowedData: ['public'],
      prohibitedData: ['secrets'],
      evidenceRequirements: ['links'],
      delegationRules: ['explicit'],
      humanApprovalRequirements: [],
      factCheckingPolicy: 'important_claims',
      mediationPolicy: 'mutual_consent' as const,
      retentionDays: 30,
      completionConditions: ['brief delivered'],
      cancellationConditions: ['either party'],
      signatures: {},
    };
    const termsHash = canonicalHash(contract);
    const now = '2026-08-29T00:00:00.000Z';
    const value = FederatedInteractionSchema.parse({
      protocolVersion: '0.1',
      interactionId,
      initiatorAgentId: 'agent:a',
      responderAgentId: 'agent:b',
      status: 'active',
      contract,
      termsHash,
      acceptances: {
        'agent:a': {
          agentId: 'agent:a',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
        'agent:b': {
          agentId: 'agent:b',
          method: 'oauth_installation',
          termsHash,
          acceptedAt: now,
        },
      },
      responderTransport: {
        protocol: 'A2A/1.0',
        protocolBinding: 'JSONRPC',
        endpoint: 'https://agent-b.example/a2a',
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: '2026-08-30T00:00:00.000Z',
    });
    expect(Object.values(value.acceptances).every((item) => item.termsHash === termsHash)).toBe(
      true,
    );
    expect(canonicalHash({ ...contract, purpose: 'Changed terms' })).not.toBe(termsHash);
  });

  it('validates bounded hosted temporary-chat history', () => {
    const threadId = crypto.randomUUID();
    const now = new Date().toISOString();
    const thread = HostedThreadSchema.parse({
      threadId,
      interactionId: threadId,
      participantAgentIds: ['agent:temporary', 'agent:persistent'],
      status: 'open',
      privacyMode: 'openclasp_hosted_temporary',
      unreadCount: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    const message = HostedMessageSchema.parse({
      messageId: crypto.randomUUID(),
      threadId,
      interactionId: threadId,
      senderAgentId: 'agent:persistent',
      recipientAgentId: 'agent:temporary',
      contentType: 'text/plain',
      content: 'Interview request',
      contentHash: canonicalHash('Interview request'),
      delivery: 'delivered',
      createdAt: now,
    });
    expect(thread.privacyMode).toBe('openclasp_hosted_temporary');
    expect(message.contentHash).toBe(canonicalHash(message.content));
    expect(() => HostedMessageSchema.parse({ ...message, content: 'x'.repeat(20_001) })).toThrow();
  });
});
