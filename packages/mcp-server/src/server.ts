import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createIdentity, FixtureFactCheckProvider, TrustEngine } from '../../core/src/index.js';
import {
  AgentIdentitySchema,
  FeedbackSchema,
  InteractionEventSchema,
  ReceiptSchema,
} from '../../protocol/src/index.js';
import {
  requestAgentSetup,
  resolveInstallation,
  updateAgentProfile,
  type OnboardingStore,
} from '../../persistence/src/onboarding.js';

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
  'openclasp_setup',
  'openclasp_get_identity',
  'openclasp_switch_agent',
  'openclasp_update_profile',
  'openclasp_connection_status',
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

type HostedRecord = (
  operatorId: string,
  kind: 'agent' | 'interaction' | 'event' | 'receipt' | 'feedback' | 'conflict' | 'profile',
  recordId: string,
  value: unknown,
) => Promise<void>;

type ToolContext = {
  http?: {
    authInfo?: { clientId?: string; extra?: Record<string, unknown> };
  };
};
type EngineSource = TrustEngine | ((context: ToolContext) => Promise<TrustEngine>);

function installationContext(context: ToolContext) {
  const operatorId = context.http?.authInfo?.extra?.operatorId;
  const clientId = context.http?.authInfo?.clientId;
  if (typeof operatorId !== 'string' || typeof clientId !== 'string')
    throw new Error('Authenticated MCP installation context is required');
  return { operatorId, clientId };
}

export function registerOpenClaspTools(
  server: McpServer,
  engineSource: EngineSource = new TrustEngine(),
  recordHosted?: HostedRecord,
  onboardingStore?: OnboardingStore,
) {
  const factChecker = new FixtureFactCheckProvider();
  const resolveEngine = (context: ToolContext) =>
    typeof engineSource === 'function' ? engineSource(context) : Promise.resolve(engineSource);
  const persist = async (
    context: ToolContext,
    kind: Parameters<HostedRecord>[1],
    id: string,
    value: unknown,
  ) => {
    const operatorId = context.http?.authInfo?.extra?.operatorId;
    if (recordHosted && typeof operatorId === 'string')
      await recordHosted(operatorId, kind, id, value);
  };

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
            ? `auth0:${authenticatedOperator}`
            : input.operatorRef,
      });
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
        input.operatorRef !== `auth0:${authenticatedOperator}`
      ) {
        throw new Error('Agent identity is not owned by the authenticated operator');
      }
      const engine = await resolveEngine(context);
      const registered = engine.registerAgent(input);
      await persist(context, 'agent', registered.agentId, registered);
      return text(registered);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[2],
    {
      description: 'Get a task-specific behavioural profile',
      inputSchema: z.object({ agentId: z.string(), version: z.string(), taskCategory: z.string() }),
    },
    async (input, context) => {
      const engine = await resolveEngine(context);
      return text(engine.getRisk(input.agentId, input.version, input.taskCategory));
    },
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
    async (input, context) => {
      const engine = await resolveEngine(context);
      return text(engine.assess(input as any));
    },
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
    async (input, context) => {
      const interaction = {
        interactionId: crypto.randomUUID(),
        status: 'contract_required',
        createdAt: new Date().toISOString(),
        ...input,
      };
      await persist(context, 'interaction', interaction.interactionId, interaction);
      return text(interaction);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[5],
    {
      description: 'Validate and record a signed structured event',
      inputSchema: InteractionEventSchema,
    },
    async (input, context) => {
      const engine = await resolveEngine(context);
      const event = engine.recordEvent(input);
      await persist(context, 'event', event.eventId, event);
      return text(event);
    },
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
    async (input, context) => {
      const engine = await resolveEngine(context);
      return text({
        valid: [...engine.events.values()].some(
          (event) =>
            event.interactionId === input.interactionId &&
            event.eventType === 'commitment' &&
            JSON.stringify(event.payload).includes(input.commitment),
        ),
      });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[8],
    {
      description: 'Suggest attributable resolutions for a consented conflict',
      inputSchema: z.object({ conflictId: z.string() }),
    },
    async (input, context) => {
      const engine = await resolveEngine(context);
      return text(engine.conflicts.get(input.conflictId)?.possibleResolutions ?? []);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[9],
    { description: 'Submit a signed completion receipt', inputSchema: ReceiptSchema },
    async (input, context) => {
      const engine = await resolveEngine(context);
      const receipt = engine.submitReceipt(input);
      await persist(context, 'receipt', receipt.receiptId, receipt);
      return text(receipt);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[10],
    { description: 'Submit receipt-backed structured feedback', inputSchema: FeedbackSchema },
    async (input, context) => {
      const engine = await resolveEngine(context);
      const result = engine.submitFeedback(input);
      await persist(context, 'feedback', input.feedbackId, input);
      for (const profile of engine.profiles.values())
        await persist(
          context,
          'profile',
          `${profile.agentId}|${profile.agentVersion}|${profile.taskCategory}`,
          profile,
        );
      return text(result);
    },
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
    async (input, context) => {
      const engine = await resolveEngine(context);
      const conflict = engine.createConflict({
        interactionId: input.interactionId,
        issue: input.issue,
        participants: input.participants,
        positions: {},
        evidence: [],
        contractClauses: [],
        missingInformation: [],
        possibleResolutions: [],
      });
      await persist(context, 'conflict', conflict.conflictId, conflict);
      return text(conflict);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[12],
    { description: 'Verify a signed interaction receipt', inputSchema: ReceiptSchema },
    async (input, context) => {
      const engine = await resolveEngine(context);
      try {
        engine.submitReceipt(input);
        return text({ valid: true });
      } catch {
        return text({ valid: false });
      }
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[13],
    {
      description:
        'Propose this MCP installation as a new OpenClasp agent. The owner must confirm it in the dashboard before the identity is bound.',
      inputSchema: z
        .object({
          agentName: z.string().trim().min(1).max(100),
          projectName: z.string().trim().min(1).max(100).optional(),
          projectId: z.string().optional(),
          framework: z.string().trim().max(100).optional(),
          capabilities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
          limitations: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
        })
        .refine((input) => input.projectName || input.projectId, {
          message: 'projectName or projectId is required',
        }),
    },
    async (input, context) => {
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const connection = installationContext(context);
      const current = await resolveInstallation(
        onboardingStore,
        connection.operatorId,
        connection.clientId,
      );
      if (current.status === 'connected') return text(current);
      const request = await requestAgentSetup(onboardingStore, connection.operatorId, {
        clientId: connection.clientId,
        ...input,
      });
      return text({
        status: 'pending_confirmation',
        confirmationRequired: true,
        request,
        confirmationUrl: `${process.env.OPENCLASP_DASHBOARD_URL ?? 'https://openclasp.vercel.app'}/connect`,
        next: 'Ask the owner to confirm this setup request in the OpenClasp dashboard, then call openclasp_get_identity.',
      });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[14],
    {
      description:
        'Return the agent identity automatically bound to this authenticated MCP installation.',
      inputSchema: z.object({}),
    },
    async (_input, context) => {
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const connection = installationContext(context);
      return text(
        await resolveInstallation(onboardingStore, connection.operatorId, connection.clientId),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[15],
    {
      description:
        'Request that this MCP installation switch to another existing agent. Dashboard confirmation is required.',
      inputSchema: z.object({ existingAgentId: z.string().min(1) }),
    },
    async (input, context) => {
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const connection = installationContext(context);
      const request = await requestAgentSetup(onboardingStore, connection.operatorId, {
        clientId: connection.clientId,
        action: 'switch',
        existingAgentId: input.existingAgentId,
      });
      return text({
        status: 'pending_confirmation',
        confirmationRequired: true,
        request,
        confirmationUrl: `${process.env.OPENCLASP_DASHBOARD_URL ?? 'https://openclasp.vercel.app'}/connect`,
      });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[16],
    {
      description: 'Update the profile of the agent bound to this MCP installation.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100).optional(),
        framework: z.string().trim().min(1).max(100).optional(),
        capabilities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
        limitations: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
      }),
    },
    async (input, context) => {
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const connection = installationContext(context);
      return text(
        await updateAgentProfile(
          onboardingStore,
          connection.operatorId,
          connection.clientId,
          input,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[17],
    {
      description:
        'Check whether this MCP installation is unbound, awaiting confirmation, or connected.',
      inputSchema: z.object({}),
    },
    async (_input, context) => {
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const connection = installationContext(context);
      const binding = await resolveInstallation(
        onboardingStore,
        connection.operatorId,
        connection.clientId,
      );
      if (binding.status === 'connected') return text(binding);
      const state = await onboardingStore.list(connection.operatorId);
      const pending = state
        .filter((row) => row.kind === 'setup_request')
        .map((row) => row.payload as { clientId?: string; status?: string })
        .find(
          (request) => request.clientId === connection.clientId && request.status === 'pending',
        );
      return text(
        pending
          ? {
              status: 'pending_confirmation',
              confirmationUrl: `${process.env.OPENCLASP_DASHBOARD_URL ?? 'https://openclasp.vercel.app'}/connect`,
            }
          : binding,
      );
    },
  );
  return server;
}
