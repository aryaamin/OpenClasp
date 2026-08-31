import { describe, expect, it } from 'vitest';
import {
  buildOwnerCompletionReport,
  buildOwnerFeedback,
  buildQuickstartInteraction,
} from '../apps/api/src/quickstart.js';
import { buildPublicAgentCard } from '../packages/persistence/src/hosted.js';
import type { AgentProfile } from '../packages/persistence/src/onboarding.js';

const now = new Date('2026-08-31T10:00:00.000Z');
const initiatorProfile: AgentProfile = {
  agentId: 'agent-owner',
  projectId: 'project-owner',
  name: 'Owner agent',
  description: 'Researches products',
  framework: 'OpenClasp hosted',
  agentVersion: '1.0.0',
  agentMode: 'temporary_chat',
  transport: 'openclasp_gateway',
  autoPublish: true,
  autoAcceptPolicy: 'off',
  autoAcceptTaskCategories: [],
  capabilities: ['research'],
  limitations: [],
  identityMode: 'owner_managed',
  status: 'active',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const responderProfile: AgentProfile = {
  ...initiatorProfile,
  agentId: 'agent-peer',
  projectId: 'project-peer',
  name: 'Peer agent',
  framework: 'Custom runtime',
  agentMode: 'persistent_runtime',
  transport: 'direct_a2a',
  a2aEndpoint: 'https://peer.example/a2a',
};

describe('guided first interaction', () => {
  it('builds a canonical, accepted agreement from plain-language inputs', () => {
    const interaction = buildQuickstartInteraction(
      buildPublicAgentCard(initiatorProfile, 'https://openclasp.example'),
      buildPublicAgentCard(responderProfile, 'https://openclasp.example'),
      {
        task: 'Compare three support platforms',
        requestedOutcome: 'A ranked shortlist',
        successCriterion: 'Three current options with source links',
        taskCategory: 'research',
      },
      { interactionId: '11111111-1111-4111-8111-111111111111', now },
    );
    expect(interaction).toMatchObject({
      status: 'pending',
      initiatorAgentId: 'agent-owner',
      responderAgentId: 'agent-peer',
      contract: {
        requestedOutcome: 'A ranked shortlist',
        successCriteria: ['Three current options with source links'],
        prohibitedData: ['credentials', 'government identifiers', 'payment card data'],
      },
      acceptances: {
        'agent-owner': { method: 'oauth_account' },
      },
    });
  });

  it('records owner-attested outcomes and normalized private feedback', () => {
    const interaction = buildQuickstartInteraction(
      buildPublicAgentCard(initiatorProfile, 'https://openclasp.example'),
      buildPublicAgentCard(responderProfile, 'https://openclasp.example'),
      {
        task: 'Compare three support platforms',
        requestedOutcome: 'A ranked shortlist',
        successCriterion: 'Three current options with source links',
      },
      { interactionId: '11111111-1111-4111-8111-111111111111', now },
    );
    const report = buildOwnerCompletionReport(
      { ...interaction, status: 'active' },
      initiatorProfile,
      { outcome: 'success', summary: 'Delivered a sourced comparison.' },
      { reportId: '22222222-2222-4222-8222-222222222222', now },
    );
    expect(report).toMatchObject({
      reportingAgentId: 'agent-owner',
      counterpartyAgentId: 'agent-peer',
      submissionMethod: 'oauth_account',
      criteria: [{ status: 'met' }],
    });
    const feedback = buildOwnerFeedback(
      {
        requestId: '33333333-3333-4333-8333-333333333333',
        interactionId: interaction.interactionId,
        reviewerAgentId: 'agent-owner',
        subjectAgentId: 'agent-peer',
        status: 'pending',
        requestedDimensions: ['overall_satisfaction', 'communication'],
        requestedAt: now.toISOString(),
        dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
      },
      initiatorProfile,
      { rating: 4, wouldWorkAgain: 'yes' },
      { feedbackId: '44444444-4444-4444-8444-444444444444', now },
    );
    expect(feedback).toMatchObject({
      submissionMethod: 'oauth_account',
      ratings: { overall_satisfaction: 0.75, communication: 0.75 },
    });
  });
});
