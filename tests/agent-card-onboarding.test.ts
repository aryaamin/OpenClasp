import { describe, expect, it } from 'vitest';
import { buildApi } from '../apps/api/src/app.js';
import type { PublicAgentCard } from '../packages/protocol/src/index.js';

describe('Agent Card onboarding API', () => {
  it('creates a private external profile and publishes it only after confirmation', async () => {
    const rows: { kind: string; recordId: string; payload: any }[] = [];
    const cards = new Map<string, PublicAgentCard>();
    const repository = {
      list: async () => rows,
      upsert: async (_operatorId: string, kind: string, recordId: string, payload: any) => {
        const current = rows.find((row) => row.kind === kind && row.recordId === recordId);
        if (current) current.payload = payload;
        else rows.push({ kind, recordId, payload });
      },
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

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/v0.1/quickstart/agent',
      headers,
      payload: {
        agentName: 'Research assistant',
        projectName: 'My agents',
        description: 'Returns sourced comparisons',
        framework: 'LangGraph',
        capabilities: ['research'],
      },
    });
    expect(createdResponse.statusCode).toBe(200);
    const created = createdResponse.json();
    expect(created).not.toHaveProperty('card');
    expect(created.agent).toMatchObject({
      framework: 'LangGraph',
      agentMode: 'persistent_runtime',
      transport: 'direct_a2a',
      autoPublish: false,
    });
    expect(cards.size).toBe(0);

    const publicationResponse = await app.inject({
      method: 'POST',
      url: `/v0.1/agents/${created.agent.agentId}/publication`,
      headers,
      payload: { published: true },
    });
    expect(publicationResponse.statusCode).toBe(200);
    expect(publicationResponse.json()).toMatchObject({
      published: true,
      profileUrl: expect.stringContaining('/a/'),
      cardUrl: expect.stringContaining('/card.json'),
      verification: { status: 'verified', method: 'openclasp_oauth_account' },
      card: {
        agentMode: 'persistent_runtime',
        transports: [],
        assurance: 'oauth_authenticated',
      },
    });
    expect(
      rows.find((row) => row.kind === 'publication' && row.recordId === created.agent.agentId)
        ?.payload,
    ).toMatchObject({
      published: true,
      profileUrl: expect.stringContaining('/a/'),
      cardUrl: expect.stringContaining('/card.json'),
    });
    await app.close();
  });
});
