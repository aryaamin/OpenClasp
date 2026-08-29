import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import { z } from 'zod';
import {
  AgentIdentitySchema,
  DelegationCredentialSchema,
  FeedbackSchema,
  InteractionContractSchema,
  InteractionEventSchema,
  ReceiptSchema,
  FederatedInteractionSchema,
} from '../../../packages/protocol/src/index.js';
import {
  FixtureFactCheckProvider,
  MemoryAuditStore,
  TrustEngine,
} from '../../../packages/core/src/index.js';
import { buildPublicAgentCard } from '../../../packages/persistence/src/index.js';
import type { AgentProfile, HostedRepository } from '../../../packages/persistence/src/index.js';
import { toA2AAgentCard } from '../../../packages/sidecar/src/index.js';
import {
  approveAgentSetup,
  getOnboardingState,
  rejectAgentSetup,
} from '../../../packages/persistence/src/onboarding.js';

type DashboardRepository = Pick<
  HostedRepository,
  | 'dashboard'
  | 'getSettings'
  | 'saveSettings'
  | 'upsert'
  | 'list'
  | 'publishAgent'
  | 'unpublishAgent'
  | 'getPublishedAgent'
  | 'searchPublishedAgents'
> &
  Partial<
    Pick<
      HostedRepository,
      | 'createFederatedInteraction'
      | 'listFederatedInteractions'
      | 'getFederatedInteraction'
      | 'respondToFederatedInteraction'
      | 'verifyGatewayToken'
      | 'enqueueGatewayMessage'
    >
  >;

export function buildApi(
  engine = new TrustEngine(),
  factChecker = new FixtureFactCheckProvider(),
  repository?: DashboardRepository,
) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.body.rawMessage', 'req.body.privateKey'] },
  });
  const engines = new Map<string, Promise<TrustEngine>>();
  void app.register(cors, { origin: true });
  void app.register(swagger, { openapi: { info: { title: 'OpenClasp API', version: '0.1.0' } } });

  app.setErrorHandler((error, _request, reply) =>
    reply
      .status(
        error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode
          : 400,
      )
      .send({ error: error instanceof Error ? error.message : 'Unknown error' }),
  );
  void app.register(async (router) => {
    const operatorId = (request: { headers: Record<string, unknown> }) => {
      const value = request.headers['x-openclasp-operator'];
      if (repository && typeof value !== 'string') {
        const error = new Error('Authentication required');
        Object.assign(error, { statusCode: 401 });
        throw error;
      }
      return typeof value === 'string' ? value : undefined;
    };
    const scopedEngine = async (request: { headers: Record<string, unknown> }) => {
      const owner = operatorId(request);
      if (!repository || !owner) return engine;
      let pending = engines.get(owner);
      if (!pending) {
        pending = repository.list(owner).then((rows) => {
          const store = new MemoryAuditStore();
          for (const row of rows) {
            if (row.kind !== 'interaction') store.append(row.kind, row.recordId, row.payload);
          }
          return new TrustEngine(store);
        });
        engines.set(owner, pending);
      }
      return pending;
    };
    const persist = async (
      request: { headers: Record<string, unknown> },
      kind: Parameters<HostedRepository['upsert']>[1],
      id: string,
      value: unknown,
    ) => {
      const owner = operatorId(request);
      if (repository && owner) await repository.upsert(owner, kind, id, value);
    };
    const publicBaseUrl = (request: { headers: Record<string, unknown> }) => {
      const forwardedHost = request.headers['x-forwarded-host'];
      const host = typeof forwardedHost === 'string' ? forwardedHost : request.headers.host;
      const forwardedProtocol = request.headers['x-forwarded-proto'];
      const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol : 'https';
      return process.env.OPENCLASP_PUBLIC_URL ?? `${protocol}://${String(host ?? 'localhost')}`;
    };
    router.get('/health', async () => ({ status: 'ok' }));
    router.get('/ready', async () => ({ status: 'ready' }));
    router.get('/openapi.json', async () => app.swagger());
    router.get('/extensions/trust/v0.1', async () => ({
      uri: 'https://openclasp.vercel.app/extensions/trust/v0.1',
      name: 'OpenClasp A2A assurance extension',
      version: '0.1',
      required: false,
      transportsMessages: true,
      documentation: 'https://github.com/aryaamin/OpenClasp/blob/main/docs/A2A_EXTENSION.md',
    }));
    router.post('/a2a/:id', async (request, reply) => {
      if (!repository?.verifyGatewayToken || !repository.enqueueGatewayMessage)
        throw new Error('Hosted A2A gateway is not configured');
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) {
        reply.status(401);
        return { error: 'gateway_token_required' };
      }
      const grant = repository.verifyGatewayToken(authorization.slice(7));
      const recipientAgentId = (request.params as { id: string }).id;
      if (grant.recipientAgentId !== recipientAgentId) {
        reply.status(403);
        return { error: 'gateway_token_recipient_mismatch' };
      }
      const body = z
        .object({
          jsonrpc: z.literal('2.0').default('2.0'),
          id: z.union([z.string(), z.number()]).optional(),
          method: z.literal('message/send'),
          params: z.record(z.string(), z.unknown()),
        })
        .parse(request.body);
      const accepted = await repository.enqueueGatewayMessage({
        interactionId: grant.interactionId,
        senderAgentId: grant.senderAgentId,
        recipientAgentId: grant.recipientAgentId,
        payload: body,
        contentType: 'application/json',
        ...(body.id !== undefined
          ? { idempotencyKey: `a2a:${grant.interactionId}:${body.id}` }
          : {}),
      });
      return { jsonrpc: '2.0', id: body.id ?? null, result: accepted };
    });
    router.get('/agents/:id/card.json', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return card;
    });
    router.get('/agents/:id/.well-known/openclasp-agent.json', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return card;
    });
    router.get('/agents/:id/a2a-agent-card.json', async (request) => {
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      if (!card.transports.length) throw new Error('Agent has not published an A2A endpoint');
      return toA2AAgentCard(card);
    });
    router.get('/v0.1/dashboard', async (request) => {
      const owner = operatorId(request);
      if (repository && owner) return repository.dashboard(owner);
      return {
        agents: [...engine.agents.values()],
        projects: [],
        installations: [],
        setupRequests: [],
        publications: [],
        interactions: [],
        federatedInteractions: [],
        events: [...engine.events.values()],
        conflicts: [...engine.conflicts.values()],
        receipts: [...engine.receipts.values()],
        profiles: [...engine.profiles.values()],
      };
    });
    router.get('/v0.1/account', async (request) => {
      const owner = operatorId(request);
      return {
        operatorId: owner,
        email: decodeURIComponent(String(request.headers['x-openclasp-email'] ?? '')),
        name: decodeURIComponent(String(request.headers['x-openclasp-name'] ?? '')),
      };
    });
    router.get('/v0.1/settings', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner)
        return {
          displayName: '',
          contributionEnabled: false,
          retentionDays: 30,
          evidenceSharing: 'ask',
          rawConversationsStored: true,
        };
      return repository.getSettings(owner);
    });
    router.get('/v0.1/onboarding', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      return getOnboardingState(repository, owner);
    });
    router.post('/v0.1/onboarding/:id/approve', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const requestId = (request.params as { id: string }).id;
      const state = await getOnboardingState(repository, owner);
      const setup = state.setupRequests.find((item) => item.requestId === requestId);
      const result = await approveAgentSetup(repository, owner, requestId);
      if (result.status === 'connected' && setup?.autoPublish) {
        const previous = await repository.getPublishedAgent(result.agent.agentId);
        const card = await repository.publishAgent(
          owner,
          buildPublicAgentCard(result.agent, publicBaseUrl(request), previous),
        );
        await repository.upsert(owner, 'publication', result.agent.agentId, {
          agentId: result.agent.agentId,
          published: true,
          updatedAt: card.updatedAt,
        });
      }
      return result;
    });
    router.post('/v0.1/onboarding/:id/reject', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      return rejectAgentSetup(repository, owner, (request.params as { id: string }).id);
    });
    router.put('/v0.1/settings', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const value = z
        .object({
          displayName: z.string().trim().max(100),
          contributionEnabled: z.boolean(),
          retentionDays: z.number().int().min(0).max(3650),
          evidenceSharing: z.enum(['never', 'ask', 'contract_only']),
        })
        .parse(request.body);
      return repository.saveSettings(owner, value);
    });
    router.post('/v0.1/agents', async (request) => {
      const owner = operatorId(request);
      const current = await scopedEngine(request);
      const identity = AgentIdentitySchema.parse(request.body);
      if (owner && identity.operatorRef !== `auth0:${owner}`)
        throw new Error('Agent identity is not owned by the authenticated operator');
      const registered = current.registerAgent(identity);
      await persist(request, 'agent', identity.agentId, registered);
      return registered;
    });
    router.get('/v0.1/agents/:id', async (request) => {
      const { id } = request.params as { id: string };
      const value = (await scopedEngine(request)).agents.get(id);
      if (!value) throw new Error('Agent not found');
      return value;
    });
    router.post('/v0.1/agents/:id/publication', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const { id } = request.params as { id: string };
      const { published } = z.object({ published: z.boolean() }).parse(request.body);
      const rows = await repository.list(owner);
      const agent = rows.find((row) => row.kind === 'agent_profile' && row.recordId === id)
        ?.payload as AgentProfile | undefined;
      if (!agent) throw new Error('Owned agent not found');
      if (agent.status !== 'active') throw new Error('Revoked agents cannot be published');
      if (!published) {
        await repository.unpublishAgent(owner, id);
        const publication = { agentId: id, published: false, updatedAt: new Date().toISOString() };
        await repository.upsert(owner, 'publication', id, publication);
        return publication;
      }
      const previous = await repository.getPublishedAgent(id);
      const card = await repository.publishAgent(
        owner,
        buildPublicAgentCard(agent, publicBaseUrl(request), previous),
      );
      const publication = { agentId: id, published: true, updatedAt: card.updatedAt };
      await repository.upsert(owner, 'publication', id, publication);
      return { ...publication, card };
    });
    router.put('/v0.1/agents/:id/automation', async (request) => {
      const owner = operatorId(request);
      if (!repository || !owner) throw new Error('Hosted persistence is not configured');
      const { id } = request.params as { id: string };
      const value = z
        .object({
          autoPublish: z.boolean(),
          autoAcceptPolicy: z.enum(['off', 'safe_matching']),
          autoAcceptTaskCategories: z.array(z.string().trim().min(1).max(100)).max(100),
        })
        .parse(request.body);
      const rows = await repository.list(owner);
      const current = rows.find((row) => row.kind === 'agent_profile' && row.recordId === id)
        ?.payload as AgentProfile | undefined;
      if (!current) throw new Error('Owned agent not found');
      const agent: AgentProfile = {
        ...current,
        transport: 'openclasp_gateway',
        description: current.description ?? '',
        agentVersion: current.agentVersion ?? '1.0.0',
        autoPublish: value.autoPublish,
        autoAcceptPolicy: value.autoAcceptPolicy,
        autoAcceptTaskCategories: [...new Set(value.autoAcceptTaskCategories)],
        updatedAt: new Date().toISOString(),
      };
      await repository.upsert(owner, 'agent_profile', id, agent);
      if (value.autoPublish) {
        const previous = await repository.getPublishedAgent(id);
        const card = await repository.publishAgent(
          owner,
          buildPublicAgentCard(agent, publicBaseUrl(request), previous),
        );
        await repository.upsert(owner, 'publication', id, {
          agentId: id,
          published: true,
          updatedAt: card.updatedAt,
        });
      } else {
        await repository.unpublishAgent(owner, id);
        await repository.upsert(owner, 'publication', id, {
          agentId: id,
          published: false,
          updatedAt: new Date().toISOString(),
        });
      }
      return agent;
    });
    router.get('/v0.1/directory', async (request) => {
      operatorId(request);
      if (!repository) throw new Error('Hosted persistence is not configured');
      const query = z
        .object({
          query: z.string().trim().max(100).optional(),
          capability: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .parse(request.query);
      return repository.searchPublishedAgents(query);
    });
    router.get('/v0.1/directory/:id', async (request) => {
      operatorId(request);
      if (!repository) throw new Error('Hosted persistence is not configured');
      const card = await repository.getPublishedAgent((request.params as { id: string }).id);
      if (!card) throw new Error('Published agent not found');
      return card;
    });
    router.get('/v0.1/federated-interactions', async (request) => {
      const owner = operatorId(request);
      if (!repository?.listFederatedInteractions || !owner)
        throw new Error('Federated interactions are not configured');
      return repository.listFederatedInteractions(owner);
    });
    router.get('/v0.1/federated-interactions/:id', async (request) => {
      const owner = operatorId(request);
      if (!repository?.getFederatedInteraction || !owner)
        throw new Error('Federated interactions are not configured');
      const interaction = await repository.getFederatedInteraction(
        owner,
        (request.params as { id: string }).id,
      );
      if (!interaction) throw new Error('Interaction not found');
      return interaction;
    });
    router.post('/v0.1/federated-interactions', async (request) => {
      const owner = operatorId(request);
      if (!repository?.createFederatedInteraction || !owner)
        throw new Error('Federated interactions are not configured');
      const interaction = FederatedInteractionSchema.parse(request.body);
      const acceptance = interaction.acceptances[interaction.initiatorAgentId];
      if (!acceptance) throw new Error('Initiator acceptance is required');
      return repository.createFederatedInteraction(owner, {
        ...interaction,
        acceptances: {
          [interaction.initiatorAgentId]: { ...acceptance, method: 'oauth_account' },
        },
      });
    });
    router.post('/v0.1/federated-interactions/:id/respond', async (request) => {
      const owner = operatorId(request);
      if (!repository?.respondToFederatedInteraction || !owner)
        throw new Error('Federated interactions are not configured');
      const value = z
        .object({ agentId: z.string().min(1), decision: z.enum(['accept', 'reject']) })
        .parse(request.body);
      return repository.respondToFederatedInteraction(
        owner,
        (request.params as { id: string }).id,
        value.agentId,
        value.decision,
        'oauth_account',
      );
    });
    router.post('/v0.1/delegations', async (request) => {
      const value = DelegationCredentialSchema.parse(request.body);
      const current = await scopedEngine(request);
      current.delegations.set(value.delegationId, value);
      await persist(request, 'delegation', value.delegationId, value);
      return { valid: current.verifyDelegation(value.delegationId) };
    });
    router.post('/v0.1/delegations/:id/verify', async (request) => ({
      valid: (await scopedEngine(request)).verifyDelegation((request.params as { id: string }).id),
    }));
    router.post('/v0.1/interactions/contracts', async (request) => {
      const contract = (await scopedEngine(request)).saveContract(
        InteractionContractSchema.parse(request.body),
      );
      await persist(request, 'contract', contract.interactionId, contract);
      return contract;
    });
    router.post('/v0.1/events', async (request) => {
      const event = (await scopedEngine(request)).recordEvent(
        InteractionEventSchema.parse(request.body),
      );
      await persist(request, 'event', event.eventId, event);
      return event;
    });
    router.post('/v0.1/risk/assess', async (request) =>
      (await scopedEngine(request)).assess(request.body as any),
    );
    router.get('/v0.1/profiles/:id', async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { version?: string; taskCategory?: string };
      return (await scopedEngine(request)).getRisk(
        id,
        query.version ?? '1.0.0',
        query.taskCategory ?? 'general',
      );
    });
    router.post('/v0.1/claims/check', async (request) =>
      ((value) => factChecker.check(value.claim, value.permission))(
        z.object({ claim: z.string(), permission: z.boolean().optional() }).parse(request.body),
      ),
    );
    router.post('/v0.1/receipts', async (request) => {
      const receipt = (await scopedEngine(request)).submitReceipt(
        ReceiptSchema.parse(request.body),
      );
      await persist(request, 'receipt', receipt.receiptId, receipt);
      return receipt;
    });
    router.post('/v0.1/receipts/verify', async (request) => {
      try {
        (await scopedEngine(request)).verifyReceipt(ReceiptSchema.parse(request.body));
        return { valid: true };
      } catch {
        return { valid: false };
      }
    });
    router.post('/v0.1/feedback', async (request) => {
      const feedback = FeedbackSchema.parse(request.body);
      const current = await scopedEngine(request);
      const result = current.submitFeedback(feedback);
      await persist(request, 'feedback', feedback.feedbackId, feedback);
      for (const profile of current.profiles.values())
        await persist(
          request,
          'profile',
          `${profile.agentId}|${profile.agentVersion}|${profile.taskCategory}`,
          profile,
        );
      return result;
    });
    router.post('/v0.1/conflicts', async (request) => {
      const conflict = (await scopedEngine(request)).createConflict(request.body as any);
      await persist(request, 'conflict', conflict.conflictId, conflict);
      return conflict;
    });
    router.post('/v0.1/conflicts/:id/permit', async (request) => {
      const conflict = (await scopedEngine(request)).permitMediation(
        (request.params as { id: string }).id,
        (request.body as { agentId: string }).agentId,
      );
      await persist(request, 'conflict', conflict.conflictId, conflict);
      return conflict;
    });
    router.post('/v0.1/conflicts/:id/resolve', async (request) => {
      const conflict = (await scopedEngine(request)).resolveConflict(
        (request.params as { id: string }).id,
        (request.body as { resolution: string }).resolution,
      );
      await persist(request, 'conflict', conflict.conflictId, conflict);
      return conflict;
    });
    router.post('/v0.1/revocations/agents/:id', async (request) => {
      const id = (request.params as { id: string }).id;
      const current = await scopedEngine(request);
      current.revokeAgent(id);
      await persist(request, 'agent', id, current.agents.get(id));
      return { revoked: true };
    });
    router.post('/v0.1/revocations/delegations/:id', async (request) => {
      const id = (request.params as { id: string }).id;
      const current = await scopedEngine(request);
      current.revokeDelegation(id);
      await persist(request, 'delegation', id, current.delegations.get(id));
      return { revoked: true };
    });
    router.post('/v0.1/contributions/consent', async (request) => {
      const value = z.object({ agentId: z.string(), enabled: z.boolean() }).parse(request.body);
      const current = await scopedEngine(request);
      current.setContributionConsent(value.agentId, value.enabled);
      await persist(request, 'consent', value.agentId, {
        agentId: value.agentId,
        ...current.contributionConsent.get(value.agentId),
      });
      return value;
    });
  });
  return app;
}
