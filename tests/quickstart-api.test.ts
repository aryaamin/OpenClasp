import { describe, expect, it } from 'vitest';
import { buildApi } from '../apps/api/src/app.js';
import { buildPublicAgentCard } from '../packages/persistence/src/hosted.js';
import type { AgentProfile } from '../packages/persistence/src/onboarding.js';
import type {
  FeedbackRequest,
  FederatedInteraction,
  PublicAgentCard,
} from '../packages/protocol/src/index.js';

describe('dashboard quickstart API', () => {
  it('creates an agent, starts an agreement, and records owner outcome and feedback', async () => {
    const rows: { kind: string; recordId: string; payload: any }[] = [];
    const cards = new Map<string, PublicAgentCard>();
    let interaction: FederatedInteraction | undefined;
    let feedbackRequest: FeedbackRequest | undefined;
    const peerProfile: AgentProfile = {
      agentId: 'agent-peer',
      projectId: 'project-peer',
      name: 'Peer runtime',
      description: 'Does product research',
      framework: 'Custom runtime',
      agentVersion: '1.0.0',
      agentMode: 'persistent_runtime',
      a2aEndpoint: 'https://peer.example/a2a',
      transport: 'direct_a2a',
      autoPublish: true,
      autoAcceptPolicy: 'off',
      autoAcceptTaskCategories: [],
      capabilities: ['research'],
      limitations: [],
      identityMode: 'owner_managed',
      status: 'active',
      createdAt: '2026-08-31T10:00:00.000Z',
      updatedAt: '2026-08-31T10:00:00.000Z',
    };
    cards.set('agent-peer', buildPublicAgentCard(peerProfile, 'https://openclasp.example'));
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
      getPublishedAgent: async (agentId: string) => cards.get(agentId),
      createFederatedInteraction: async (_operatorId: string, value: FederatedInteraction) => {
        interaction = value;
        return value;
      },
      getFederatedInteraction: async () => interaction,
      getLiveSession: async () => ({ activatedAt: '2026-08-31T10:01:00.000Z' }),
      submitCompletionReport: async (
        _operatorId: string,
        _agentId: string,
        report: any,
        method: string,
      ) => {
        rows.push({ kind: 'completion_report', recordId: report.reportId, payload: report });
        feedbackRequest = {
          requestId: '33333333-3333-4333-8333-333333333333',
          interactionId: report.interactionId,
          reviewerAgentId: report.reportingAgentId,
          subjectAgentId: report.counterpartyAgentId,
          status: 'pending',
          requestedDimensions: ['overall_satisfaction'],
          requestedAt: '2026-08-31T10:02:00.000Z',
          dueAt: '2026-09-01T10:02:00.000Z',
        };
        return { report, method };
      },
      listFeedbackRequests: async () => (feedbackRequest ? [feedbackRequest] : []),
      submitInteractionFeedback: async (
        _operatorId: string,
        _agentId: string,
        feedback: any,
        method: string,
      ) => ({ feedback, method }),
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
        capabilities: ['research'],
      },
    });
    expect(createdResponse.statusCode).toBe(200);
    const created = createdResponse.json();
    expect(created.card).toMatchObject({
      agentMode: 'temporary_chat',
      transports: [{ managedBy: 'openclasp' }],
    });

    const startedResponse = await app.inject({
      method: 'POST',
      url: '/v0.1/federated-interactions/start',
      headers,
      payload: {
        initiatorAgentId: created.agent.agentId,
        responderAgentId: 'agent-peer',
        task: 'Compare three customer support platforms',
        requestedOutcome: 'A ranked shortlist',
        successCriterion: 'Three current products with source links',
      },
    });
    expect(startedResponse.statusCode).toBe(200);
    expect(startedResponse.json()).toMatchObject({
      status: 'pending',
      acceptances: { [created.agent.agentId]: { method: 'oauth_account' } },
    });
    interaction = { ...interaction!, status: 'active' };

    const completedResponse = await app.inject({
      method: 'POST',
      url: `/v0.1/federated-interactions/${interaction.interactionId}/complete`,
      headers,
      payload: {
        agentId: created.agent.agentId,
        outcome: 'success',
        summary: 'Delivered a ranked, sourced shortlist.',
      },
    });
    expect(completedResponse.statusCode).toBe(200);
    expect(completedResponse.json()).toMatchObject({
      method: 'oauth_account',
      report: { submissionMethod: 'oauth_account' },
    });

    const feedbackResponse = await app.inject({
      method: 'POST',
      url: `/v0.1/feedback-requests/${feedbackRequest!.requestId}/respond`,
      headers,
      payload: {
        agentId: created.agent.agentId,
        rating: 5,
        wouldWorkAgain: 'yes',
      },
    });
    expect(feedbackResponse.statusCode).toBe(200);
    expect(feedbackResponse.json()).toMatchObject({
      method: 'oauth_account',
      feedback: { ratings: { overall_satisfaction: 1 } },
    });
    await app.close();
  });
});
