import { z, IntegrationDefinition } from '@botpress/sdk';
import { integrationName } from './package.json';

export default new IntegrationDefinition({
  name: integrationName,
  version: '0.1.0',
  title: 'OpenClasp',
  description: 'Direct A2A runtime connectivity with OpenClasp assurance and identity.',
  readme: 'hub.md',
  icon: 'icon.svg',
  configuration: {
    schema: z.object({
      openClaspAgentToken: z
        .string()
        .min(20)
        .secret()
        .title('OpenClasp agent token')
        .describe('The oc_at_ token created for this exact agent in OpenClasp.'),
      openClaspUrl: z.string().url().default('https://openclasp.vercel.app').title('OpenClasp URL'),
    }),
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
        sessionsJson: z.string(),
        offersJson: z.string(),
      }),
    },
  },
});
