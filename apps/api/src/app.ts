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
} from '../../../packages/protocol/src/index.js';
import {
  FixtureFactCheckProvider,
  MemoryAuditStore,
  TrustEngine,
} from '../../../packages/core/src/index.js';
import type { HostedRepository } from '../../../packages/persistence/src/index.js';

type DashboardRepository = Pick<
  HostedRepository,
  'dashboard' | 'getSettings' | 'saveSettings' | 'upsert' | 'list'
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
    router.get('/health', async () => ({ status: 'ok' }));
    router.get('/ready', async () => ({ status: 'ready' }));
    router.get('/openapi.json', async () => app.swagger());
    router.get('/v0.1/dashboard', async (request) => {
      const owner = operatorId(request);
      if (repository && owner) return repository.dashboard(owner);
      return {
        agents: [...engine.agents.values()],
        interactions: [],
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
          rawConversationsStored: false,
        };
      return repository.getSettings(owner);
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
        (await scopedEngine(request)).submitReceipt(ReceiptSchema.parse(request.body));
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
