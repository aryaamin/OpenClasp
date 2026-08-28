import type { AgentCard, AgentExtension } from '@a2a-js/sdk';
import {
  DEFAULT_EXTENSION_URI,
  type InteractionEvent,
  type TrustEnvelope,
  type PublicAgentCard,
} from '../../protocol/src/index.js';
import { TrustEngine, type PolicyContext } from '../../core/src/index.js';

export type A2AMessageLike = {
  role: 'ROLE_USER' | 'ROLE_AGENT' | 'user' | 'agent';
  parts: unknown[];
  extensions?: string[];
  metadata?: Record<string, unknown>;
};

export function openClaspA2AExtension(uri = DEFAULT_EXTENSION_URI): AgentExtension {
  return {
    uri,
    description: 'OpenClasp trust, contract, and behavioural-assurance envelope',
    required: false,
    params: {},
  };
}

export function toA2AAgentCard(card: PublicAgentCard): AgentCard {
  return {
    name: card.name,
    description: card.description || `${card.name} via OpenClasp`,
    supportedInterfaces: card.transports.map((transport) => ({
      url: transport.endpoint,
      protocolBinding: transport.protocolBinding,
      protocolVersion: '1.0',
      tenant: '',
    })),
    provider: undefined,
    version: card.agentVersion,
    documentationUrl: card.cardUrl,
    capabilities: {
      extensions: [
        {
          ...openClaspA2AExtension(card.extensionUri),
          params: {
            agentId: card.agentId,
            openClaspCardUrl: card.cardUrl,
          },
        },
      ],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: card.capabilities.map((capability) => ({
      id:
        capability
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'general',
      name: capability,
      description: capability,
      tags: [card.framework],
      examples: [],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain', 'application/json'],
      securityRequirements: [],
    })),
    signatures: [],
  };
}

export class OpenClaspSidecar {
  constructor(
    readonly engine: TrustEngine,
    readonly extensionUri = DEFAULT_EXTENSION_URI,
  ) {}

  async forward<T>(input: {
    message: A2AMessageLike;
    envelope: TrustEnvelope;
    policy: Omit<PolicyContext, 'envelope'>;
    structuredEvents?: InteractionEvent[];
    send: (message: A2AMessageLike) => Promise<T>;
  }): Promise<{
    forwarded: boolean;
    decision: ReturnType<TrustEngine['assess']>;
    response?: T;
    networkPayloads: Record<string, unknown>[];
  }> {
    const embedded = input.message.metadata?.[this.extensionUri];
    if (!embedded) throw new Error('Missing OpenClasp A2A extension metadata');
    const decision = this.engine.assess({ envelope: input.envelope, ...input.policy });
    if (decision.decision === 'DENY') return { forwarded: false, decision, networkPayloads: [] };
    const networkPayloads = (input.structuredEvents ?? [])
      .map((event) => {
        this.engine.recordEvent(event);
        return this.engine.networkContribution(event);
      })
      .filter((value): value is Record<string, unknown> => value !== null);
    const response = await input.send(input.message);
    return { forwarded: true, decision, response, networkPayloads };
  }
}
