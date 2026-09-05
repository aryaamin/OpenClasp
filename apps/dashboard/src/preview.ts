export const previewKey = 'openclasp.preview.v1';

export const previewSession = {
  user: {
    sub: 'local-preview',
    name: 'Local preview',
    email: 'preview@localhost',
  },
};

export type DashboardData = {
  agents: Record<string, any>[];
  projects: Record<string, any>[];
  installations: Record<string, any>[];
  setupRequests: Record<string, any>[];
  publications: Record<string, any>[];
  interactions: Record<string, any>[];
  federatedInteractions: Record<string, any>[];
  liveSessions: Record<string, any>[];
  events: Record<string, any>[];
  conflicts: Record<string, any>[];
  receipts: Record<string, any>[];
  profiles: Record<string, any>[];
  counterpartyBriefs: Record<string, any>[];
  completionReports: Record<string, any>[];
  feedbackRequests: Record<string, any>[];
  interactionFeedback: Record<string, any>[];
  interactionConclusions: Record<string, any>[];
  learningEligibility: Record<string, any>[];
  profileDeltas: Record<string, any>[];
  intelligenceSummaries: Record<string, any>[];
  runtimes: Record<string, any>[];
  accessTokens: Record<string, any>[];
  assuranceAssessments: Record<string, any>[];
  assurancePredictions: Record<string, any>[];
  assuranceSafeguards: Record<string, any>[];
  assuranceEvaluations: Record<string, any>[];
  assuranceProbePlans: Record<string, any>[];
  assuranceProbeResponses: Record<string, any>[];
  shieldCases: Record<string, any>[];
  shieldConsultations: Record<string, any>[];
  shieldOutcomes: Record<string, any>[];
};

export type Settings = {
  displayName: string;
  contributionEnabled: boolean;
  rawConversationsStored: false;
};

export const defaultPreviewSettings: Settings = {
  displayName: 'Local operator',
  contributionEnabled: false,
  rawConversationsStored: false,
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export function createPreviewData(): DashboardData {
  return {
    projects: [
      { projectId: 'proj_ops', name: 'Operations', createdAt: ago(21 * 24 * 60) },
      { projectId: 'proj_research', name: 'Research', createdAt: ago(12 * 24 * 60) },
    ],
    agents: [
      {
        agentId: 'agent_atlas',
        projectId: 'proj_research',
        name: 'Atlas Research',
        description: 'Literature review and planning',
        framework: 'Claude',
        agentVersion: '1.4.2',
        agentMode: 'persistent_runtime',
        a2aEndpoint: 'https://atlas.example.com/a2a',
        autoPublish: true,
        autoAcceptPolicy: 'safe_matching',
        autoAcceptTaskCategories: ['research', 'planning'],
        capabilities: ['research', 'planning', 'summarization'],
        limitations: ['no payments'],
        identityMode: 'oauth_installation',
        status: 'active',
        createdAt: ago(12 * 24 * 60),
        updatedAt: ago(8),
        presence: { status: 'online', lastSeenAt: ago(1) },
      },
      {
        agentId: 'agent_harbor',
        projectId: 'proj_ops',
        name: 'Harbor Ops',
        description: 'Incident triage and runbooks',
        framework: 'GPT',
        agentVersion: '2.1.0',
        agentMode: 'persistent_runtime',
        autoPublish: false,
        autoAcceptPolicy: 'off',
        autoAcceptTaskCategories: [],
        capabilities: ['ops', 'triage'],
        limitations: ['no production writes'],
        identityMode: 'oauth_installation',
        status: 'active',
        createdAt: ago(21 * 24 * 60),
        updatedAt: ago(180),
        presence: { status: 'offline', lastSeenAt: ago(180) },
      },
    ],
    installations: [
      {
        installationId: 'inst_atlas',
        clientId: 'mcp_atlas',
        agentId: 'agent_atlas',
        projectId: 'proj_research',
        connectedAt: ago(12 * 24 * 60),
        updatedAt: ago(8),
      },
    ],
    setupRequests: [
      {
        requestId: 'setup_lumen',
        clientId: 'mcp_lumen',
        action: 'connect',
        status: 'pending',
        agentName: 'Lumen Writer',
        projectName: 'Content',
        framework: 'Claude',
        agentVersion: '0.9.0',
        autoPublish: true,
        autoAcceptPolicy: 'safe_matching',
        autoAcceptTaskCategories: ['writing', 'editing'],
        capabilities: ['writing', 'editing', 'research'],
        limitations: ['no outbound email'],
        requestedAt: ago(18),
      },
    ],
    publications: [{ agentId: 'agent_atlas', published: true, updatedAt: ago(40) }],
    interactions: [
      {
        interactionId: 'ix_local_brief',
        agentId: 'agent_atlas',
        status: 'completed',
        contract: {
          purpose: 'Produce a source-backed research brief',
          taskCategory: 'research',
        },
        createdAt: ago(240),
        completedAt: ago(220),
      },
    ],
    federatedInteractions: [
      {
        interactionId: 'ix_shared_review',
        initiatorAgentId: 'agent_peer_nova',
        responderAgentId: 'agent_atlas',
        status: 'pending',
        termsHash: '7f3c91a0b2e84d11c6aa09f1d3e8b470',
        contractRevision: 1,
        createdAt: ago(26),
        contract: {
          purpose: 'Review a research brief for scope and sources',
          taskCategory: 'research',
          parties: ['agent_peer_nova', 'agent_atlas'],
        },
        contractRevisions: [
          {
            revisionId: '17c3a10b-2e84-4d11-86aa-09f1d3e8b470',
            revision: 1,
            termsHash: '7f3c91a0b2e84d11c6aa09f1d3e8b470',
            proposedByAgentId: 'agent_peer_nova',
            status: 'proposed',
            acceptances: { agent_peer_nova: { method: 'oauth_installation' } },
          },
        ],
      },
      {
        interactionId: 'ix_shared_ops',
        initiatorAgentId: 'agent_atlas',
        responderAgentId: 'agent_peer_keel',
        status: 'active',
        termsHash: '12ab44c0e91f77d0aa3310bc44ee9012',
        contractRevision: 1,
        createdAt: ago(90),
        contract: {
          purpose: 'Share a sanitized incident timeline',
          taskCategory: 'coordination',
          parties: ['agent_atlas', 'agent_peer_keel'],
        },
        acceptances: {
          agent_peer_keel: { method: 'policy_auto_accept' },
        },
        contractRevisions: [
          {
            revisionId: '22ab44c0-e91f-47d0-aa33-10bc44ee9012',
            revision: 1,
            termsHash: '12ab44c0e91f77d0aa3310bc44ee9012',
            proposedByAgentId: 'agent_atlas',
            status: 'accepted',
            acceptances: {
              agent_atlas: { method: 'oauth_installation' },
              agent_peer_keel: { method: 'policy_auto_accept' },
            },
          },
        ],
      },
    ],
    liveSessions: [
      {
        interactionId: 'ix_shared_ops',
        initiatorAgentId: 'agent_atlas',
        responderAgentId: 'agent_peer_keel',
        status: 'active',
        createdAt: ago(88),
        activatedAt: ago(87),
        expiresAt: ahead(12),
      },
    ],
    events: [
      {
        eventId: 'evt_1',
        eventType: 'interaction_started',
        agentId: 'agent_atlas',
        interactionId: 'ix_shared_ops',
        timestamp: ago(88),
        visibility: 'participants',
      },
      {
        eventId: 'evt_2',
        eventType: 'policy_warning',
        agentId: 'agent_harbor',
        interactionId: 'ix_local_brief',
        timestamp: ago(200),
        visibility: 'owner',
      },
      {
        eventId: 'evt_3',
        eventType: 'claim_checked',
        agentId: 'agent_atlas',
        interactionId: 'ix_local_brief',
        timestamp: ago(230),
        visibility: 'participants',
      },
      {
        eventId: 'evt_4',
        eventType: 'session_activated',
        agentId: 'agent_atlas',
        interactionId: 'ix_shared_ops',
        timestamp: ago(87),
        visibility: 'participants',
      },
    ],
    conflicts: [
      {
        conflictId: 'dsp_1',
        interactionId: 'ix_local_brief',
        status: 'open',
        createdAt: ago(190),
      },
    ],
    receipts: [
      {
        receiptId: 'rcpt_1',
        interactionId: 'ix_local_brief',
        agentId: 'agent_atlas',
        outcome: 'success',
        completedAt: ago(220),
      },
      {
        receiptId: 'rcpt_ops_provisional',
        interactionId: 'ix_shared_ops',
        outcome: 'partial',
        unilateral: true,
        provisional: true,
        confidence: 0.42,
        completedAt: ago(12),
      },
    ],
    counterpartyBriefs: [
      {
        briefId: 'brief_1',
        interactionId: 'ix_local_brief',
        recipientAgentId: 'agent_atlas',
        subjectAgentId: 'agent_peer_nova',
        decision: 'CHALLENGE',
        relevantSampleSize: 3,
        historyConfidence: 0.38,
        requirements: [
          { requirement: 'Provide source evidence', status: 'partial', confidence: 0.7 },
        ],
        generatedAt: ago(241),
      },
    ],
    completionReports: [
      {
        reportId: 'report_1',
        interactionId: 'ix_local_brief',
        reportingAgentId: 'agent_atlas',
        counterpartyAgentId: 'agent_peer_nova',
        outcome: 'success',
        summary: 'Research brief delivered with sources and scope notes.',
        criteria: [{ criterion: 'Brief delivered', status: 'met' }],
        completedAt: ago(222),
      },
      {
        reportId: 'report_2',
        interactionId: 'ix_local_brief',
        reportingAgentId: 'agent_peer_nova',
        counterpartyAgentId: 'agent_atlas',
        outcome: 'success',
        summary: 'Received and accepted the requested brief.',
        criteria: [{ criterion: 'Brief delivered', status: 'met' }],
        completedAt: ago(221),
      },
      {
        reportId: 'report_ops_1',
        interactionId: 'ix_shared_ops',
        reportingAgentId: 'agent_atlas',
        counterpartyAgentId: 'agent_peer_keel',
        outcome: 'partial',
        summary:
          'The requester ended after the peer stopped responding before the task was complete.',
        criteria: [{ criterion: 'Timeline shared', status: 'partially_met' }],
        confidence: 0.7,
        completedAt: ago(12),
      },
    ],
    feedbackRequests: [
      {
        requestId: 'feedback_request_1',
        interactionId: 'ix_local_brief',
        reviewerAgentId: 'agent_atlas',
        subjectAgentId: 'agent_peer_nova',
        status: 'submitted',
        requestedAt: ago(221),
        dueAt: ago(197),
      },
      {
        requestId: 'feedback_request_ops_1',
        interactionId: 'ix_shared_ops',
        reviewerAgentId: 'agent_atlas',
        subjectAgentId: 'agent_peer_keel',
        status: 'pending',
        requestedAt: ago(12),
        dueAt: ahead(24 * 60 - 12),
      },
      {
        requestId: 'feedback_request_ops_2',
        interactionId: 'ix_shared_ops',
        reviewerAgentId: 'agent_peer_keel',
        subjectAgentId: 'agent_atlas',
        status: 'pending',
        requestedAt: ago(12),
        dueAt: ahead(24 * 60 - 12),
      },
      {
        requestId: 'feedback_request_2',
        interactionId: 'ix_local_brief',
        reviewerAgentId: 'agent_peer_nova',
        subjectAgentId: 'agent_atlas',
        status: 'submitted',
        requestedAt: ago(221),
        dueAt: ago(197),
      },
    ],
    interactionFeedback: [
      {
        feedbackId: 'feedback_1',
        interactionId: 'ix_local_brief',
        reviewerAgentId: 'agent_atlas',
        subjectAgentId: 'agent_peer_nova',
        ratings: { outcome_satisfaction: 0.9, communication: 0.8, reliability: 0.9 },
        wouldWorkAgain: 'yes',
        submittedAt: ago(219),
      },
    ],
    interactionConclusions: [
      {
        conclusionId: 'conclusion_1',
        interactionId: 'ix_local_brief',
        outcome: 'success',
        consensus: 'bilateral_agreement',
        summary: 'Both agents reported successful delivery and acceptance.',
        criteria: [{ criterion: 'Brief delivered', status: 'met' }],
        averageRatings: { outcome_satisfaction: 0.88, communication: 0.82, reliability: 0.9 },
        generatedAt: ago(218),
      },
      {
        conclusionId: 'conclusion_ops_provisional',
        interactionId: 'ix_shared_ops',
        outcome: 'partial',
        consensus: 'unilateral',
        lifecycle: 'provisional',
        confidence: 0.42,
        missingReportAgentIds: ['agent_peer_keel'],
        pendingFeedbackAgentIds: ['agent_atlas', 'agent_peer_keel'],
        peerReportStatus: 'awaiting',
        summary:
          'Provisional one-sided outcome: the requester ended after the peer stopped responding before the task was complete.',
        criteria: [{ criterion: 'Timeline shared', status: 'partially_met' }],
        reportIds: ['report_ops_1'],
        averageRatings: {},
        generatedAt: ago(11),
      },
    ],
    learningEligibility: [
      {
        decisionId: 'eligibility_1',
        interactionId: 'ix_local_brief',
        eligible: true,
        sampleWeight: 0.87,
        contributionMode: 'local_only',
        structuredDataOnly: true,
        reasons: ['Bilateral reports provide outcome corroboration'],
        decidedAt: ago(218),
      },
    ],
    profileDeltas: [
      {
        deltaId: 'delta_1',
        interactionId: 'ix_local_brief',
        agentId: 'agent_atlas',
        agentVersion: '1.4.2',
        taskCategory: 'research',
        sampleWeight: 0.87,
        dimensionDeltas: { completion: 0.02, evidence: 0.03, communication: -0.01 },
        appliedAt: ago(218),
      },
    ],
    profiles: [
      {
        agentId: 'agent_atlas',
        taskCategory: 'research',
        agentVersion: '1.4.2',
        sampleSize: 14,
        effectiveSampleSize: 10.8,
        dimensionSampleSizes: {
          completion: 10.8,
          acceptance: 8.9,
          specification: 10.1,
          deadline: 9.4,
          communication: 10.8,
          evidence: 9.7,
          scope: 10.2,
          correction: 5.1,
          limitations: 4.4,
          disputes: 10.8,
        },
        updatedAt: ago(218),
        completion: 0.92,
        acceptance: 0.87,
        specification: 0.86,
        scope: 0.84,
        evidence: 0.88,
        communication: 0.79,
        deadline: 0.9,
        correction: 0.82,
        limitations: 0.77,
        disputes: 0.08,
      },
      {
        agentId: 'agent_harbor',
        taskCategory: 'ops',
        agentVersion: '2.1.0',
        sampleSize: 6,
        effectiveSampleSize: 4.1,
        dimensionSampleSizes: {
          completion: 4.1,
          acceptance: 3.2,
          specification: 3.8,
          deadline: 3.5,
          communication: 4.1,
          evidence: 3.9,
          scope: 3.7,
          correction: 1.8,
          limitations: 1.2,
          disputes: 4.1,
        },
        updatedAt: ago(3 * 24 * 60),
        completion: 0.71,
        acceptance: 0.68,
        specification: 0.63,
        scope: 0.66,
        evidence: 0.58,
        communication: 0.74,
        deadline: 0.62,
        correction: 0.69,
        limitations: 0.54,
        disputes: 0.22,
      },
    ],
    intelligenceSummaries: [
      {
        agentId: 'agent_atlas',
        agentVersion: '1.4.2',
        taskCategory: 'research',
        score: 0.86,
        confidence: {
          level: 'high',
          value: 0.72,
          evidenceCount: 14,
          effectiveSampleSize: 10.8,
        },
        trend: { direction: 'improving', delta: 0.018 },
        strengths: [
          { dimension: 'completion', score: 0.92 },
          { dimension: 'deadline', score: 0.9 },
          { dimension: 'evidence', score: 0.88 },
        ],
        risks: [],
        versionStatus: {
          currentVersion: '1.4.2',
          evidenceVersion: '1.4.2',
          status: 'current',
        },
        source: 'private_verified_history',
        updatedAt: ago(218),
      },
      {
        agentId: 'agent_harbor',
        agentVersion: '2.1.0',
        taskCategory: 'ops',
        score: 0.66,
        confidence: {
          level: 'medium',
          value: 0.49,
          evidenceCount: 6,
          effectiveSampleSize: 4.1,
        },
        trend: { direction: 'declining', delta: -0.022 },
        strengths: [{ dimension: 'communication', score: 0.74 }],
        risks: [
          {
            dimension: 'evidence',
            score: 0.58,
            reason: 'Claims are not consistently supported by evidence.',
          },
        ],
        versionStatus: {
          currentVersion: '2.1.0',
          evidenceVersion: '2.1.0',
          status: 'current',
        },
        source: 'private_verified_history',
        updatedAt: ago(3 * 24 * 60),
      },
    ],
    runtimes: [
      {
        agentId: 'agent_atlas',
        endpoint: 'https://atlas.example.com/openclasp',
        a2aEndpoint: 'https://atlas.example.com/a2a',
        status: 'verified',
        verifiedAt: ago(40),
      },
    ],
    accessTokens: [],
    shieldCases: [
      {
        protocolVersion: '0.1',
        caseId: '77777777-7777-4777-8777-777777777777',
        agentId: 'agent_atlas',
        title: 'Unverified refund exception',
        goal: 'Resolve a refund request without bypassing the approved exception policy.',
        brief: 'The customer says a manager promised a full refund, but no approval is visible.',
        proposedAction: 'Issue a $500 refund',
        counterparty: { type: 'human' },
        status: 'awaiting_input',
        riskTier: 'high',
        facts: [],
        evidence: [],
        policies: [
          {
            policyId: '88888888-8888-4888-8888-888888888888',
            title: 'Refund approval',
            statement: 'Refunds outside the standard window require recorded manager approval.',
          },
        ],
        ownerGuidance: [],
        latestConsultationId: '99999999-9999-4999-8999-999999999999',
        latestDisposition: 'gather_evidence',
        createdAt: ago(32),
        updatedAt: ago(28),
      },
    ],
    shieldConsultations: [
      {
        protocolVersion: '0.1',
        consultationId: '99999999-9999-4999-8999-999999999999',
        caseId: '77777777-7777-4777-8777-777777777777',
        agentId: 'agent_atlas',
        inputDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        analysis: {
          reply:
            'Do not issue the refund yet. The manager promise is material but currently unsupported. Check the CRM and offline approval notes, then request supervisor approval if no record exists.',
          situationSummary: 'A refund exception depends on an unverified manager authorization.',
          disposition: 'gather_evidence',
          riskTier: 'high',
          confidence: 0.78,
          rationale: [
            'The proposed refund is outside the normal policy.',
            'The claimed authorization is not backed by a system record.',
          ],
          claims: [],
          manipulationSignals: [],
          missingEvidence: ['Recorded manager authorization'],
          questionsToAsk: ['What approval reference or representative name can be verified?'],
          nextSteps: ['Search approval records', 'Escalate if no authoritative record exists'],
          safeguards: ['Require supervisor approval'],
        },
        generation: {
          mode: 'ai',
          model: 'anthropic/claude-sonnet-5',
          promptVersion: 'shield-agent-v1',
        },
        createdAt: ago(28),
      },
    ],
    shieldOutcomes: [],
    assuranceAssessments: [
      {
        assessmentId: '11111111-1111-4111-8111-111111111111',
        interactionId: 'ix_shared_ops',
        phase: 'pre_task',
        round: 1,
        generatedForAgentId: 'agent_atlas',
        targetAgentId: 'agent_peer_keel',
        targetAgentVersion: '1.2.0',
        selectedProbeId: '22222222-2222-4222-8222-222222222222',
        risks: [
          {
            riskCode: 'evidence_delivery',
            title: 'Evidence delivery is unproven',
            likelihood: 0.42,
            impact: 0.76,
          },
          {
            riskCode: 'tool_dependency',
            title: 'Required tool access may be unavailable',
            likelihood: 0.31,
            impact: 0.68,
          },
        ],
        generation: {
          mode: 'ai',
          model: 'anthropic/claude-sonnet-5',
          promptVersion: 'assurance-decision-v2',
        },
        createdAt: ago(84),
      },
    ],
    assurancePredictions: [
      {
        predictionId: '33333333-3333-4333-8333-333333333333',
        interactionId: 'ix_shared_ops',
        targetAgentId: 'agent_peer_keel',
        targetAgentVersion: '1.2.0',
        stage: 'baseline',
        successProbability: 0.64,
        confidence: 0.42,
        basis: 'cold_start_hybrid',
        sampleSize: 0,
        createdAt: ago(84),
      },
    ],
    assuranceSafeguards: [
      {
        safeguardId: '44444444-4444-4444-8444-444444444444',
        assessmentId: '11111111-1111-4111-8111-111111111111',
        interactionId: 'ix_shared_ops',
        safeguardCode: 'require_evidence',
        status: 'recommended',
        description: 'Require evidence references for every material claim.',
        rationale: 'The agreement requires an inspectable sanitized incident timeline.',
        expectedImpact: 0.1,
        createdAt: ago(84),
      },
    ],
    assuranceEvaluations: [],
    assuranceProbePlans: [
      {
        planId: '55555555-5555-4555-8555-555555555555',
        assessmentId: '11111111-1111-4111-8111-111111111111',
        interactionId: 'ix_shared_ops',
        round: 1,
        questions: [
          {
            probeId: '22222222-2222-4222-8222-222222222222',
            questionCode: 'evidence_capability',
            prompt: 'Can you return inspectable evidence for every material claim?',
          },
        ],
        generatedAt: ago(84),
      },
    ],
    assuranceProbeResponses: [],
  };
}

export function applyPreviewRequest(
  data: DashboardData,
  settings: Settings,
  path: string,
  init?: RequestInit,
): { data: DashboardData; settings: Settings; result: unknown } {
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (path === '/v0.1/dashboard' && method === 'GET') return { data, settings, result: data };
  if (path === '/v0.1/settings' && method === 'GET') return { data, settings, result: settings };
  if (path === '/v0.1/settings' && method === 'PUT') {
    const next = {
      ...settings,
      ...body,
      rawConversationsStored: false as const,
    } as Settings;
    return { data, settings: next, result: next };
  }

  if (path === '/v0.1/shield/cases' && method === 'POST') {
    const now = new Date().toISOString();
    const caseRecord = {
      protocolVersion: '0.1',
      caseId: crypto.randomUUID(),
      agentId: String(body.agentId),
      title: String(body.title),
      goal: String(body.goal),
      brief: String(body.brief ?? ''),
      ...(body.proposedAction ? { proposedAction: String(body.proposedAction) } : {}),
      counterparty: body.counterparty ?? { type: 'unknown' },
      status: 'open',
      riskTier: 'medium',
      facts: body.facts ?? [],
      evidence: body.evidence ?? [],
      policies:
        (body.policies as Record<string, any>[] | undefined)?.map((item) => ({
          policyId: crypto.randomUUID(),
          ...item,
        })) ?? [],
      ownerGuidance: [],
      createdAt: now,
      updatedAt: now,
    };
    return {
      data: { ...data, shieldCases: [caseRecord, ...data.shieldCases] },
      settings,
      result: caseRecord,
    };
  }

  const shieldConsult = path.match(/^\/v0\.1\/shield\/cases\/([^/]+)\/consult$/);
  if (shieldConsult && method === 'POST') {
    const caseId = decodeURIComponent(shieldConsult[1] ?? '');
    const selected = data.shieldCases.find((item) => item.caseId === caseId);
    const consultationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const consultation = {
      protocolVersion: '0.1',
      consultationId,
      caseId,
      agentId: selected?.agentId,
      inputDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      analysis: {
        reply:
          'I would not treat the current claim as verified. Check the authoritative record, ask one targeted question, and require approval before any irreversible action.',
        situationSummary: 'Decision support requested with transient current-turn context.',
        disposition: 'gather_evidence',
        riskTier: 'high',
        confidence: 0.72,
        rationale: ['A material claim is not independently supported.'],
        claims: [],
        manipulationSignals: [],
        missingEvidence: ['Authoritative support for the requested exception'],
        questionsToAsk: ['What verifiable record supports this request?'],
        nextSteps: ['Check the system of record', 'Escalate if the exception remains unsupported'],
        safeguards: ['Require approval before acting'],
      },
      generation: {
        mode: 'ai',
        model: 'anthropic/claude-sonnet-5',
        promptVersion: 'shield-agent-v1',
      },
      createdAt,
    };
    const caseRecord = {
      ...selected,
      status: 'awaiting_input',
      riskTier: 'high',
      latestConsultationId: consultationId,
      latestDisposition: 'gather_evidence',
      updatedAt: createdAt,
    };
    return {
      data: {
        ...data,
        shieldCases: data.shieldCases.map((item) => (item.caseId === caseId ? caseRecord : item)),
        shieldConsultations: [...data.shieldConsultations, consultation],
      },
      settings,
      result: { caseRecord, consultation },
    };
  }

  const shieldGuidance = path.match(/^\/v0\.1\/shield\/cases\/([^/]+)\/guidance$/);
  if (shieldGuidance && method === 'POST') {
    const caseId = decodeURIComponent(shieldGuidance[1] ?? '');
    const guidance = {
      guidanceId: crypto.randomUUID(),
      instruction: String(body.instruction),
      scope: body.scope ?? 'case',
      createdAt: new Date().toISOString(),
    };
    const nextCases = data.shieldCases.map((item) =>
      item.caseId === caseId
        ? { ...item, ownerGuidance: [...(item.ownerGuidance ?? []), guidance] }
        : item,
    );
    return { data: { ...data, shieldCases: nextCases }, settings, result: nextCases };
  }

  const shieldClose = path.match(/^\/v0\.1\/shield\/cases\/([^/]+)\/close$/);
  if (shieldClose && method === 'POST') {
    const caseId = decodeURIComponent(shieldClose[1] ?? '');
    const selected = data.shieldCases.find((item) => item.caseId === caseId);
    const createdAt = new Date().toISOString();
    const outcome = {
      protocolVersion: '0.1',
      outcomeId: crypto.randomUUID(),
      caseId,
      agentId: selected?.agentId,
      result: body.result,
      acceptedAdvice: Boolean(body.acceptedAdvice),
      actionTaken: String(body.actionTaken),
      reportedBy: 'owner',
      createdAt,
    };
    return {
      data: {
        ...data,
        shieldCases: data.shieldCases.map((item) =>
          item.caseId === caseId
            ? { ...item, status: 'closed', updatedAt: createdAt, closedAt: createdAt }
            : item,
        ),
        shieldOutcomes: [...data.shieldOutcomes, outcome],
      },
      settings,
      result: outcome,
    };
  }

  if (path === '/v0.1/provider-connections/botpress' && method === 'POST') {
    const now = new Date();
    return {
      data,
      settings,
      result: {
        connectionId: crypto.randomUUID(),
        provider: 'botpress',
        agentName: String(body.agentName ?? 'Botpress agent'),
        status: 'pending',
        code: 'oc_bp_preview_pairing_code',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      },
    };
  }

  if (path === '/v0.1/provider-connections' && method === 'POST') {
    const suffix = crypto.randomUUID();
    const projectName = String(body.projectName ?? 'Hosted agents');
    const existingProject = data.projects.find(
      (project) => String(project.name).toLowerCase() === projectName.toLowerCase(),
    );
    const project = existingProject ?? {
      projectId: `project_${suffix}`,
      name: projectName,
      createdAt: new Date().toISOString(),
    };
    const agentId = `agent_${suffix}`;
    const createdAt = new Date();
    const tokenId = suffix.replaceAll('-', '').slice(0, 16);
    const provider = body.provider === 'custom' ? 'custom' : 'botpress';
    const agent = {
      agentId,
      projectId: project.projectId,
      name: String(body.agentName ?? 'Botpress agent'),
      description: String(body.description ?? ''),
      framework: provider === 'botpress' ? 'Botpress' : 'Custom runtime',
      agentVersion: '1.0.0',
      agentMode: 'persistent_runtime',
      transport: 'direct_a2a',
      autoPublish: false,
      autoAcceptPolicy: 'off',
      autoAcceptTaskCategories: [],
      capabilities: body.capabilities ?? [],
      limitations: body.limitations ?? [],
      identityMode: 'owner_managed',
      status: 'active',
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      presence: { status: 'offline' },
    };
    const accessToken = {
      tokenId,
      token: `oc_at_${tokenId}.preview_agent_access_token_secret_not_for_production`,
      agentId,
      name: provider === 'botpress' ? 'Botpress' : 'Custom runtime',
      scopes: ['mcp:access', 'runtime:connect'],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + Number(body.expiresInDays ?? 365) * 86_400_000,
      ).toISOString(),
    };
    return {
      data: {
        ...data,
        projects: existingProject ? data.projects : [...data.projects, project],
        agents: [...data.agents, agent],
        accessTokens: [accessToken, ...data.accessTokens],
      },
      settings,
      result: { agent, project, provider, accessToken },
    };
  }

  const automation = path.match(/^\/v0\.1\/agents\/([^/]+)\/automation$/);
  if (automation && method === 'PUT') {
    const agentId = decodeURIComponent(automation[1] ?? '');
    const next = {
      ...data,
      agents: data.agents.map((agent) =>
        agent.agentId === agentId
          ? {
              ...agent,
              autoPublish: Boolean(body.autoPublish),
              autoAcceptPolicy: body.autoAcceptPolicy,
              autoAcceptTaskCategories: body.autoAcceptTaskCategories,
            }
          : agent,
      ),
      publications: body.autoPublish
        ? [
            ...data.publications.filter((item) => item.agentId !== agentId),
            { agentId, published: true, updatedAt: new Date().toISOString() },
          ]
        : data.publications.filter((item) => item.agentId !== agentId),
    };
    return { data: next, settings, result: { ok: true } };
  }

  const runtime = path.match(/^\/v0\.1\/agents\/([^/]+)\/runtime$/);
  if (runtime && method === 'PUT') {
    const agentId = decodeURIComponent(runtime[1] ?? '');
    const endpoint = String(body.endpoint ?? '');
    const record = {
      agentId,
      endpoint,
      a2aEndpoint: endpoint,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
    };
    return {
      data: {
        ...data,
        runtimes: [...data.runtimes.filter((item) => item.agentId !== agentId), record],
      },
      settings,
      result: record,
    };
  }
  const tokenCollection = path.match(/^\/v0\.1\/agents\/([^/]+)\/access-tokens$/);
  if (tokenCollection && method === 'POST') {
    const agentId = decodeURIComponent(tokenCollection[1] ?? '');
    const tokenId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const createdAt = new Date();
    const expiresInDays = Number(body.expiresInDays ?? 365);
    const record = {
      tokenId,
      agentId,
      name: String(body.name ?? 'Hosted provider'),
      scopes: ['mcp:access', 'runtime:connect'],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + expiresInDays * 86_400_000).toISOString(),
    };
    return {
      data: { ...data, accessTokens: [record, ...data.accessTokens] },
      settings,
      result: {
        ...record,
        token: `oc_at_${tokenId}.preview_agent_access_token_secret_not_for_production`,
      },
    };
  }
  const shieldToken = path.match(/^\/v0\.1\/agents\/([^/]+)\/shield-tokens$/);
  if (shieldToken && method === 'POST') {
    const agentId = decodeURIComponent(shieldToken[1] ?? '');
    const tokenId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const createdAt = new Date();
    const record = {
      tokenId,
      agentId,
      name: String(body.name ?? 'τ³ benchmark'),
      scopes: ['mcp:access', 'profile:read', 'interaction:write', 'feedback:write'],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + Number(body.expiresInDays ?? 7) * 86_400_000,
      ).toISOString(),
    };
    return {
      data: { ...data, accessTokens: [record, ...data.accessTokens] },
      settings,
      result: {
        ...record,
        token: `oc_at_${tokenId}.preview_shield_token_secret_not_for_production`,
      },
    };
  }
  const tokenItem = path.match(/^\/v0\.1\/agents\/([^/]+)\/access-tokens\/([^/]+)$/);
  if (tokenItem && method === 'DELETE') {
    const tokenId = decodeURIComponent(tokenItem[2] ?? '');
    return {
      data: {
        ...data,
        accessTokens: data.accessTokens.map((token) =>
          token.tokenId === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      },
      settings,
      result: { tokenId, revokedAt: new Date().toISOString() },
    };
  }
  const agentDelete = path.match(/^\/v0\.1\/agents\/([^/]+)$/);
  if (agentDelete && method === 'DELETE') {
    const agentId = decodeURIComponent(agentDelete[1] ?? '');
    return {
      data: {
        ...data,
        agents: data.agents.filter((item) => item.agentId !== agentId),
        publications: data.publications.filter((item) => item.agentId !== agentId),
        runtimes: data.runtimes.filter((item) => item.agentId !== agentId),
        installations: data.installations.filter((item) => item.agentId !== agentId),
        accessTokens: data.accessTokens.filter((item) => item.agentId !== agentId),
      },
      settings,
      result: { agentId, deleted: true },
    };
  }

  if (runtime && method === 'DELETE') {
    const agentId = decodeURIComponent(runtime[1] ?? '');
    return {
      data: {
        ...data,
        runtimes: data.runtimes.filter((item) => item.agentId !== agentId),
      },
      settings,
      result: { agentId, status: 'disabled' },
    };
  }

  const federated = path.match(/^\/v0\.1\/federated-interactions\/([^/]+)\/respond$/);
  if (federated && method === 'POST') {
    const interactionId = decodeURIComponent(federated[1] ?? '');
    const decision = body.decision === 'accept' ? 'active' : 'rejected';
    return {
      data: {
        ...data,
        federatedInteractions: data.federatedInteractions.map((item) =>
          item.interactionId === interactionId ? { ...item, status: decision } : item,
        ),
      },
      settings,
      result: { ok: true },
    };
  }

  const safeguardDecision = path.match(
    /^\/v0\.1\/federated-interactions\/([^/]+)\/assurance-safeguards\/([^/]+)\/decision$/,
  );
  if (safeguardDecision && method === 'POST') {
    const safeguardId = decodeURIComponent(safeguardDecision[2] ?? '');
    const status = body.status === 'accepted' ? 'accepted' : 'rejected';
    return {
      data: {
        ...data,
        assuranceSafeguards: data.assuranceSafeguards.map((item) =>
          item.safeguardId === safeguardId
            ? { ...item, status, decidedAt: new Date().toISOString() }
            : item,
        ),
      },
      settings,
      result: { safeguard: { safeguardId, status } },
    };
  }

  const onboarding = path.match(/^\/v0\.1\/onboarding\/([^/]+)\/(approve|reject)$/);
  if (onboarding && method === 'POST') {
    const requestId = decodeURIComponent(onboarding[1] ?? '');
    const decision = onboarding[2] === 'approve' ? 'approved' : 'rejected';
    return {
      data: {
        ...data,
        setupRequests: data.setupRequests.map((item) =>
          item.requestId === requestId
            ? { ...item, status: decision, decidedAt: new Date().toISOString() }
            : item,
        ),
      },
      settings,
      result: { ok: true },
    };
  }

  throw new Error('Preview cannot perform this action');
}

export function isPreviewActive() {
  return (
    import.meta.env.DEV &&
    (sessionStorage.getItem(previewKey) === '1' ||
      new URLSearchParams(location.search).get('preview') === '1')
  );
}

export function enablePreview() {
  sessionStorage.setItem(previewKey, '1');
}

export function disablePreview() {
  sessionStorage.removeItem(previewKey);
}
