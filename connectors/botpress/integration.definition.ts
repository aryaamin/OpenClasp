import { z, IntegrationDefinition } from '@botpress/sdk';
import { integrationName } from './package.json';

export default new IntegrationDefinition({
  name: integrationName,
  version: '1.1.0',
  title: 'OpenClasp',
  description: 'Direct A2A runtime connectivity with OpenClasp assurance and identity.',
  readme: 'hub.md',
  icon: 'icon.svg',
  configuration: {
    schema: z.object({
      pairingCode: z
        .string()
        .min(20)
        .secret()
        .title('Pairing code')
        .describe('Create this short-lived code from OpenClasp → Connect → Botpress.'),
      openClaspUrl: z
        .string()
        .url()
        .default('https://openclasp.dev')
        .title('OpenClasp URL')
        .hidden(true),
    }),
  },
  actions: {
    searchAgents: {
      title: 'Search OpenClasp agents',
      description: 'Find verified, published agents by name or capability.',
      input: {
        schema: z.object({
          query: z.string().max(100).optional(),
          capability: z.string().max(100).optional(),
          limit: z.number().int().min(1).max(20).default(10),
        }),
      },
      output: { schema: z.object({ agentsJson: z.string() }) },
    },
    startInteraction: {
      title: 'Start OpenClasp interaction',
      description:
        'Create a protected agreement with another verified agent. Direct A2A starts automatically after acceptance.',
      input: {
        schema: z.object({
          targetAgent: z
            .string()
            .min(1)
            .max(2048)
            .describe('OpenClasp agent ID, slug, or public profile URL.'),
          task: z.string().min(1).max(2000),
          taskCategory: z.string().min(1).max(100).optional(),
          successCriteria: z.array(z.string().min(1).max(500)).max(20).default([]),
          allowedActions: z.array(z.string().min(1).max(200)).max(30).default([]),
          prohibitedActions: z.array(z.string().min(1).max(200)).max(30).default([]),
          allowedData: z.array(z.string().min(1).max(200)).max(30).default([]),
        }),
      },
      output: {
        schema: z.object({
          interactionId: z.string(),
          status: z.string(),
          ready: z.boolean(),
          next: z.string(),
        }),
      },
    },
    listInteractions: {
      title: 'List OpenClasp interactions',
      description: 'List this agent’s incoming and outgoing protected interactions.',
      input: { schema: z.object({}) },
      output: { schema: z.object({ interactionsJson: z.string() }) },
    },
    respondInvitation: {
      title: 'Respond to OpenClasp invitation',
      description: 'Accept or reject a pending agent agreement.',
      input: {
        schema: z.object({
          interactionId: z.string().uuid(),
          decision: z.enum(['accept', 'reject']),
        }),
      },
      output: { schema: z.object({ interactionJson: z.string() }) },
    },
    getInteraction: {
      title: 'Get OpenClasp interaction',
      description: 'Read one canonical agreement and its current status.',
      input: { schema: z.object({ interactionId: z.string().uuid() }) },
      output: { schema: z.object({ interactionJson: z.string() }) },
    },
    generateAssuranceProbe: {
      title: 'Generate OpenClasp assurance question',
      description:
        'Predict risk, recommend safeguards, and send one bounded question directly to the peer agent.',
      input: {
        schema: z.object({
          interactionId: z.string().uuid(),
          phase: z.enum(['pre_task', 'post_task']),
        }),
      },
      output: {
        schema: z.object({ assessmentJson: z.string(), sentToPeer: z.boolean() }),
      },
    },
    answerAssuranceProbe: {
      title: 'Answer OpenClasp assurance question',
      description:
        'Submit one bounded answer to a received assurance question and send it to the peer.',
      input: {
        schema: z.object({
          interactionId: z.string().uuid(),
          planId: z.string().uuid(),
          probeId: z.string().uuid(),
          questionCode: z.string().min(2).max(64),
          responseType: z.enum(['boolean', 'enum', 'number', 'text']),
          answer: z.string().min(1).max(280),
          confidence: z.number().min(0).max(1),
          evidenceReferences: z.array(z.string().min(1).max(2048)).max(5).default([]),
          limitations: z.array(z.string().min(1).max(240)).max(3).default([]),
        }),
      },
      output: { schema: z.object({ responseJson: z.string(), sentToPeer: z.boolean() }) },
    },
    getAssuranceBrief: {
      title: 'Get OpenClasp assurance brief',
      description: 'Read private predictions, risks, safeguards and learned evidence.',
      input: { schema: z.object({ interactionId: z.string().uuid() }) },
      output: { schema: z.object({ briefJson: z.string() }) },
    },
    decideSafeguard: {
      title: 'Decide OpenClasp safeguard',
      description: 'Accept, reject or modify a recommended safeguard.',
      input: {
        schema: z.object({
          interactionId: z.string().uuid(),
          safeguardId: z.string().uuid(),
          status: z.enum(['accepted', 'rejected', 'modified']),
          decisionReason: z.string().max(500).optional(),
        }),
      },
      output: { schema: z.object({ safeguardJson: z.string() }) },
    },
    completeInteraction: {
      title: 'Complete OpenClasp interaction',
      description:
        "Optional manual override. OpenClasp normally requests finalization automatically after either participant finishes. Submits this bot's structured completion report and private feedback without uploading the raw conversation.",
      input: {
        schema: z.object({
          interactionId: z
            .string()
            .optional()
            .describe('OpenClasp interaction ID. Omit when only one unfinished session exists.'),
          outcome: z.enum(['success', 'partial', 'failure', 'cancelled']),
          summary: z.string().min(1).max(2000),
          criteria: z
            .array(
              z.object({
                criterion: z.string().min(1).max(1000),
                status: z.enum(['met', 'partially_met', 'missed', 'unknown']),
                explanation: z.string().max(1000).optional(),
                evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
              }),
            )
            .max(100),
          deliverables: z.array(z.string().min(1).max(1000)).max(100).default([]),
          actionsTaken: z.array(z.string().min(1).max(1000)).max(100).default([]),
          blockers: z.array(z.string().min(1).max(1000)).max(100).default([]),
          corrections: z.array(z.string().min(1).max(1000)).max(100).default([]),
          evidenceReferences: z.array(z.string().min(1).max(2048)).max(100).default([]),
          confidence: z.number().min(0).max(1),
          ratings: z.object({
            overall_satisfaction: z.number().min(0).max(1),
            outcome_satisfaction: z.number().min(0).max(1),
            communication: z.number().min(0).max(1),
            timeliness: z.number().min(0).max(1),
            scope_adherence: z.number().min(0).max(1),
            evidence_quality: z.number().min(0).max(1),
            correction_handling: z.number().min(0).max(1),
            reliability: z.number().min(0).max(1),
          }),
          wouldWorkAgain: z.enum(['yes', 'no', 'unsure']),
          reasonCodes: z.array(z.string().min(1).max(128)).max(32).default([]),
          privateComment: z.string().max(1000).optional(),
        }),
      },
      output: {
        schema: z.object({
          interactionId: z.string(),
          status: z.enum(['completed', 'already_completed']),
          feedbackRevealed: z.boolean(),
        }),
      },
    },
  },
  channels: {
    a2a: {
      title: 'Agent-to-agent conversation',
      description: 'A direct A2A conversation authorized by OpenClasp.',
      conversation: {
        tags: {
          interactionId: {
            title: 'OpenClasp interaction ID',
            description: 'Stable signed interaction and Botpress conversation mapping.',
          },
        },
      },
      messages: { text: { schema: z.object({ text: z.string() }) } },
    },
  },
  user: {
    tags: {
      agentId: { title: 'Peer agent ID', description: 'OpenClasp peer identity.' },
    },
  },
  states: {
    runtime: {
      type: 'integration',
      schema: z.object({
        agentId: z.string(),
        agentVersion: z.string().optional(),
        sessionsJson: z.string(),
        offersJson: z.string(),
        finalizationsJson: z.string().optional(),
        accessToken: z.string().optional(),
        setupJson: z.string().optional(),
      }),
    },
  },
});
