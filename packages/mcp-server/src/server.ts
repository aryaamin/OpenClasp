import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createIdentity, FixtureFactCheckProvider, TrustEngine } from '../../core/src/index.js';
import {
  AgentIdentitySchema,
  FeedbackSchema,
  InteractionEventSchema,
  ReceiptSchema,
} from '../../protocol/src/index.js';

export const OPENCLASP_TOOL_NAMES = [
  'openclasp_create_identity',
  'openclasp_register_agent',
  'openclasp_get_profile',
  'openclasp_assess_counterparty',
  'openclasp_begin_interaction',
  'openclasp_record_event',
  'openclasp_check_claim',
  'openclasp_validate_commitment',
  'openclasp_suggest_resolution',
  'openclasp_complete_interaction',
  'openclasp_submit_feedback',
  'openclasp_raise_dispute',
  'openclasp_verify_receipt',
] as const;

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export function buildMcpServer(engine = new TrustEngine()) {
  const server = new McpServer(
    { name: 'openclasp', version: '0.1.0' },
    {
      instructions:
        'Use OpenClasp to verify counterparties, record signed structured events, and request contextual risk decisions. Never send raw private conversations.',
    },
  );
  return registerOpenClaspTools(server, engine);
}

export function registerOpenClaspTools(server: McpServer, engine = new TrustEngine()) {
  const factChecker = new FixtureFactCheckProvider();
  const keys = new Map<string, unknown>();

  server.registerTool(
    OPENCLASP_TOOL_NAMES[0],
    {
      description: 'Create a local Ed25519 agent identity',
      inputSchema: z.object({
        agentId: z.string(),
        operatorRef: z.string(),
        capabilities: z.array(z.string()),
      }),
    },
    async (input, context) => {
      const authenticatedOperator = context.http?.authInfo?.extra?.operatorId;
      const created = createIdentity({
        ...input,
        operatorRef:
          typeof authenticatedOperator === 'string'
            ? `descope:${authenticatedOperator}`
            : input.operatorRef,
      });
      keys.set(input.agentId, created.keyPair);
      return text(created);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[1],
    {
      description: 'Register and verify a signed agent identity',
      inputSchema: AgentIdentitySchema,
    },
    async (input, context) => {
      const authenticatedOperator = context.http?.authInfo?.extra?.operatorId;
      if (
        typeof authenticatedOperator === 'string' &&
        input.operatorRef !== `descope:${authenticatedOperator}`
      ) {
        throw new Error('Agent identity is not owned by the authenticated operator');
      }
      return text(engine.registerAgent(input));
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[2],
    {
      description: 'Get a task-specific behavioural profile',
      inputSchema: z.object({ agentId: z.string(), version: z.string(), taskCategory: z.string() }),
    },
    async (input) => text(engine.getRisk(input.agentId, input.version, input.taskCategory)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[3],
    {
      description: 'Assess a counterparty in context',
      inputSchema: z.object({
        envelope: z.any(),
        action: z.string(),
        dataClasses: z.array(z.string()).optional(),
        humanApproved: z.boolean().optional(),
      }),
    },
    async (input) => text(engine.assess(input as any)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[4],
    {
      description: 'Begin an interaction and return its identifier',
      inputSchema: z.object({
        purpose: z.string(),
        parties: z.array(z.string()),
        taskCategory: z.string(),
      }),
    },
    async (input) =>
      text({ interactionId: crypto.randomUUID(), status: 'contract_required', ...input }),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[5],
    {
      description: 'Validate and record a signed structured event',
      inputSchema: InteractionEventSchema,
    },
    async (input) => text(engine.recordEvent(input)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[6],
    {
      description: 'Check an objective factual claim',
      inputSchema: z.object({ claim: z.string(), permission: z.boolean().optional() }),
    },
    async (input) => text(await factChecker.check(input.claim, input.permission)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[7],
    {
      description: 'Check whether a commitment is represented by a signed event',
      inputSchema: z.object({ interactionId: z.string().uuid(), commitment: z.string() }),
    },
    async (input) =>
      text({
        valid: [...engine.events.values()].some(
          (event) =>
            event.interactionId === input.interactionId &&
            event.eventType === 'commitment' &&
            JSON.stringify(event.payload).includes(input.commitment),
        ),
      }),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[8],
    {
      description: 'Suggest attributable resolutions for a consented conflict',
      inputSchema: z.object({ conflictId: z.string() }),
    },
    async (input) => text(engine.conflicts.get(input.conflictId)?.possibleResolutions ?? []),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[9],
    { description: 'Submit a signed completion receipt', inputSchema: ReceiptSchema },
    async (input) => text(engine.submitReceipt(input)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[10],
    { description: 'Submit receipt-backed structured feedback', inputSchema: FeedbackSchema },
    async (input) => text(engine.submitFeedback(input)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[11],
    {
      description: 'Create a mutually consented dispute',
      inputSchema: z.object({
        interactionId: z.string().uuid(),
        issue: z.string(),
        participants: z.array(z.string()).min(2),
      }),
    },
    async (input) =>
      text(
        engine.createConflict({
          interactionId: input.interactionId,
          issue: input.issue,
          participants: input.participants,
          positions: {},
          evidence: [],
          contractClauses: [],
          missingInformation: [],
          possibleResolutions: [],
        }),
      ),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[12],
    { description: 'Verify a signed interaction receipt', inputSchema: ReceiptSchema },
    async (input) => {
      try {
        engine.submitReceipt(input);
        return text({ valid: true });
      } catch {
        return text({ valid: false });
      }
    },
  );
  return server;
}
