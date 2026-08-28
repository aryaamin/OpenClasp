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
import { FixtureFactCheckProvider, TrustEngine } from '../../../packages/core/src/index.js';

export function buildApi(engine = new TrustEngine(), factChecker = new FixtureFactCheckProvider()) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.body.rawMessage', 'req.body.privateKey'] },
  });
  void app.register(cors, { origin: true });
  void app.register(swagger, { openapi: { info: { title: 'OpenClasp API', version: '0.1.0' } } });

  app.setErrorHandler((error, _request, reply) =>
    reply.status(400).send({ error: error instanceof Error ? error.message : 'Unknown error' }),
  );
  void app.register(async (router) => {
    router.get('/health', async () => ({ status: 'ok' }));
    router.get('/ready', async () => ({ status: 'ready' }));
    router.get('/openapi.json', async () => app.swagger());
    router.get('/v0.1/dashboard', async () => ({
      agents: [...engine.agents.values()],
      events: [...engine.events.values()],
      conflicts: [...engine.conflicts.values()],
      receipts: [...engine.receipts.values()],
      profiles: [...engine.profiles.values()],
    }));
    router.post('/v0.1/agents', async (request) =>
      engine.registerAgent(AgentIdentitySchema.parse(request.body)),
    );
    router.get('/v0.1/agents/:id', async (request) => {
      const { id } = request.params as { id: string };
      const value = engine.agents.get(id);
      if (!value) throw new Error('Agent not found');
      return value;
    });
    router.post('/v0.1/delegations', async (request) => {
      const value = DelegationCredentialSchema.parse(request.body);
      engine.delegations.set(value.delegationId, value);
      return { valid: engine.verifyDelegation(value.delegationId) };
    });
    router.post('/v0.1/delegations/:id/verify', async (request) => ({
      valid: engine.verifyDelegation((request.params as { id: string }).id),
    }));
    router.post('/v0.1/interactions/contracts', async (request) =>
      engine.saveContract(InteractionContractSchema.parse(request.body)),
    );
    router.post('/v0.1/events', async (request) =>
      engine.recordEvent(InteractionEventSchema.parse(request.body)),
    );
    router.post('/v0.1/risk/assess', async (request) => engine.assess(request.body as any));
    router.get('/v0.1/profiles/:id', async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { version?: string; taskCategory?: string };
      return engine.getRisk(id, query.version ?? '1.0.0', query.taskCategory ?? 'general');
    });
    router.post('/v0.1/claims/check', async (request) =>
      ((value) => factChecker.check(value.claim, value.permission))(
        z.object({ claim: z.string(), permission: z.boolean().optional() }).parse(request.body),
      ),
    );
    router.post('/v0.1/receipts', async (request) =>
      engine.submitReceipt(ReceiptSchema.parse(request.body)),
    );
    router.post('/v0.1/receipts/verify', async (request) => {
      try {
        engine.submitReceipt(ReceiptSchema.parse(request.body));
        return { valid: true };
      } catch {
        return { valid: false };
      }
    });
    router.post('/v0.1/feedback', async (request) =>
      engine.submitFeedback(FeedbackSchema.parse(request.body)),
    );
    router.post('/v0.1/conflicts', async (request) => engine.createConflict(request.body as any));
    router.post('/v0.1/conflicts/:id/permit', async (request) =>
      engine.permitMediation(
        (request.params as { id: string }).id,
        (request.body as { agentId: string }).agentId,
      ),
    );
    router.post('/v0.1/conflicts/:id/resolve', async (request) =>
      engine.resolveConflict(
        (request.params as { id: string }).id,
        (request.body as { resolution: string }).resolution,
      ),
    );
    router.post('/v0.1/revocations/agents/:id', async (request) => {
      engine.revokeAgent((request.params as { id: string }).id);
      return { revoked: true };
    });
    router.post('/v0.1/revocations/delegations/:id', async (request) => {
      engine.revokeDelegation((request.params as { id: string }).id);
      return { revoked: true };
    });
    router.post('/v0.1/contributions/consent', async (request) => {
      const value = z.object({ agentId: z.string(), enabled: z.boolean() }).parse(request.body);
      engine.setContributionConsent(value.agentId, value.enabled);
      return value;
    });
  });
  return app;
}
