import { describe, expect, it } from 'vitest';
import { buildApi } from '../apps/api/src/app.js';
import type { PublicAgentCard } from '../packages/protocol/src/index.js';

describe('connector-first Agent Card onboarding API', () => {
  it('accepts an agent profile, requires owner approval, and blocks publication until runtime verification', async () => {
    const rows: { kind: string; recordId: string; payload: any }[] = [];
    const cards = new Map<string, PublicAgentCard>();
    const claim = {
      claimId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'pending' as const,
      runtimeEndpoint: 'https://agent.example/openclasp',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      profile: {
        description: 'Compares approved suppliers and prepares purchases',
        framework: 'LangGraph',
        agentVersion: '2.1.0',
        capabilities: ['compare supplier quotes'],
        limitations: ['requires human approval before payment'],
      },
    };
    let runtimeVerified = false;
    const repository = {
      list: async () => rows,
      upsert: async (_operatorId: string, kind: string, recordId: string, payload: any) => {
        const current = rows.find((row) => row.kind === kind && row.recordId === recordId);
        if (current) current.payload = payload;
        else rows.push({ kind, recordId, payload });
      },
      createConnectorClaim: async () => ({ ...claim, claimSecret: 'oc_cc_secret' }),
      getConnectorClaim: async () => claim,
      approveConnectorClaim: async (_owner: string, _claimId: string, name: string) => {
        const agent = {
          agentId: 'agent-connected',
          projectId: 'project-connected',
          ...claim.profile,
          name,
          nameProvenance: 'operator_attested',
          profileProvenance: 'self_declared',
          identityMode: 'connector_claim',
          status: 'active',
          autoPublish: false,
          autoAcceptPolicy: 'off',
          autoAcceptTaskCategories: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        rows.push({ kind: 'agent_profile', recordId: agent.agentId, payload: agent });
        return { ...claim, status: 'approved', agentId: agent.agentId, agent };
      },
      rejectConnectorClaim: async () => ({ ...claim, status: 'rejected' }),
      listAgentRuntimes: async () =>
        runtimeVerified
          ? [{ agentId: 'agent-connected', status: 'verified', endpoint: claim.runtimeEndpoint }]
          : [],
      publishAgent: async (_operatorId: string, card: PublicAgentCard) => {
        cards.set(card.agentId, card);
        return card;
      },
      unpublishAgent: async (_operatorId: string, agentId: string) => cards.delete(agentId),
      getPublishedAgent: async (agentId: string) => cards.get(agentId),
    } as any;
    const app = buildApi(undefined, undefined, repository);
    await app.ready();
    const headers = { 'x-openclasp-operator': 'owner-a' };

    const start = await app.inject({
      method: 'POST',
      url: '/v0.1/connector-claims',
      payload: {
        runtimeEndpoint: claim.runtimeEndpoint,
        credentialPublicKey: 'public-key',
        profile: claim.profile,
      },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({
      claimId: claim.claimId,
      claimSecret: 'oc_cc_secret',
      confirmationUrl: expect.stringContaining(`/connect?claim=${claim.claimId}`),
    });

    const missingName = await app.inject({
      method: 'POST',
      url: `/v0.1/connector-claims/${claim.claimId}/approve`,
      headers,
      payload: {},
    });
    expect(missingName.statusCode).toBe(400);

    const approved = await app.inject({
      method: 'POST',
      url: `/v0.1/connector-claims/${claim.claimId}/approve`,
      headers,
      payload: { name: 'Purchasing agent' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      status: 'approved',
      agent: {
        name: 'Purchasing agent',
        identityMode: 'connector_claim',
        nameProvenance: 'operator_attested',
        profileProvenance: 'self_declared',
      },
    });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v0.1/agents/agent-connected/publication',
          headers,
          payload: { published: true },
        })
      ).json(),
    ).toEqual({ error: 'Verify the agent runtime before publishing' });

    runtimeVerified = true;
    const publication = await app.inject({
      method: 'POST',
      url: '/v0.1/agents/agent-connected/publication',
      headers,
      payload: { published: true },
    });
    expect(publication.statusCode).toBe(200);
    expect(publication.json()).toMatchObject({ published: true, card: { transports: [] } });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v0.1/quickstart/agent',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });
});
