import { z, IntegrationDefinition } from '@botpress/sdk';
import { integrationName } from './package.json';

export default new IntegrationDefinition({
  name: integrationName,
  version: '0.5.1',
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
