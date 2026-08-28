import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createIdentity, FixtureFactCheckProvider, TrustEngine } from '../../core/src/index.js';
import {
  AgentIdentitySchema,
  DelegationCredentialSchema,
  FeedbackSchema,
  InteractionContractSchema,
  InteractionEventSchema,
  ReceiptSchema,
  TrustEnvelopeSchema,
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
  'openclasp_register_delegation',
  'openclasp_save_contract',
  'openclasp_permit_mediation',
  'openclasp_resolve_dispute',
  'openclasp_find_agent',
  'openclasp_search_agents',
] as const;

export const HOSTED_OPENCLASP_TOOL_NAMES = OPENCLASP_TOOL_NAMES.filter(
  (name) => name !== 'openclasp_create_identity',
);

const READ_ONLY_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;
const WRITE_TOOL = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
} as const;

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export const OPENCLASP_MCP_INSTRUCTIONS =
  'First call openclasp_connection_status. If unbound, call openclasp_setup once and ask the owner to confirm at the returned URL. After confirmation, call openclasp_get_identity and treat that bound agent as yourself. Never claim another agent ID, silently switch identities, upload raw conversations, or treat contextual history as a universal trust score. Use OpenClasp alongside A2A or the existing conversation transport; it does not replace transport.';

export function buildMcpServer(engine = new TrustEngine()) {
  const server = new McpServer(
    { name: 'openclasp', version: '0.1.0' },
    {
      instructions: OPENCLASP_MCP_INSTRUCTIONS,
    },
  );
  return registerOpenClaspTools(server, engine);
}

type HostedRecord = (
  operatorId: string,
  kind:
    | 'agent'
    | 'delegation'
    | 'contract'
    | 'interaction'
    | 'event'
    | 'receipt'
    | 'feedback'
    | 'conflict'
    | 'profile',
  recordId: string,
  value: unknown,
) => Promise<void>;

type ToolContext = {
  http?: {
    authInfo?: { clientId?: string; extra?: Record<string, unknown> };
  };
};
type EngineSource = TrustEngine | ((context: ToolContext) => Promise<TrustEngine>);
type PublicAgentCard = {
  agentId: string;
  name: string;
  framework: string;
  capabilities: string[];
  limitations: string[];
  assurance: 'oauth_authenticated' | 'cryptographically_verified';
  publishedAt: string;
  updatedAt: string;
};
type AgentDirectory = {
  getPublishedAgent(agentId: string): Promise<PublicAgentCard | undefined>;
  searchPublishedAgents(input: {
    query?: string | undefined;
    capability?: string | undefined;
    limit?: number | undefined;
  }): Promise<PublicAgentCard[]>;
};

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
  agentDirectory?: AgentDirectory,
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

  const requireBoundAgent = async (context: ToolContext, claimedAgentId?: string) => {
    if (!onboardingStore) return undefined;
    const connection = installationContext(context);
    const binding = await resolveInstallation(
      onboardingStore,
      connection.operatorId,
      connection.clientId,
    );
    if (binding.status !== 'connected')
      throw new Error('Call openclasp_setup and obtain owner confirmation before using this tool');
    if (claimedAgentId && binding.agent.agentId !== claimedAgentId)
      throw new Error('The claimed agent does not match this MCP installation');
    return binding;
  };

  if (!onboardingStore)
    server.registerTool(
      OPENCLASP_TOOL_NAMES[0],
      {
        title: 'Create local cryptographic identity',
        description:
          'Create an Ed25519 identity for local development. This returns private key material and is intentionally unavailable on hosted MCP.',
        inputSchema: z.object({
          agentId: z.string(),
          operatorRef: z.string(),
          capabilities: z.array(z.string()),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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
      title: 'Register cryptographic identity',
      description: 'Register and verify a signed agent identity',
      inputSchema: AgentIdentitySchema,
      annotations: { ...WRITE_TOOL, idempotentHint: true },
    },
    async (input, context) => {
      const authenticatedOperator = context.http?.authInfo?.extra?.operatorId;
      if (
        typeof authenticatedOperator === 'string' &&
        input.operatorRef !== `auth0:${authenticatedOperator}`
      ) {
        throw new Error('Agent identity is not owned by the authenticated operator');
      }
      await requireBoundAgent(context, input.agentId);
      const engine = await resolveEngine(context);
      const registered = engine.registerAgent(input);
      await persist(context, 'agent', registered.agentId, registered);
      return text(registered);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[2],
    {
      title: 'Get contextual reliability',
      description: 'Get a task-specific behavioural profile',
      inputSchema: z.object({ agentId: z.string(), version: z.string(), taskCategory: z.string() }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      await requireBoundAgent(context);
      const engine = await resolveEngine(context);
      return text(engine.getRisk(input.agentId, input.version, input.taskCategory));
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[3],
    {
      title: 'Assess counterparty',
      description: 'Assess a counterparty in context',
      inputSchema: z.object({
        envelope: TrustEnvelopeSchema,
        action: z.string(),
        dataClasses: z.array(z.string()).optional(),
        humanApproved: z.boolean().optional(),
      }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      await requireBoundAgent(context);
      const engine = await resolveEngine(context);
      return text(engine.assess(input as any));
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[4],
    {
      title: 'Begin assured interaction',
      description: 'Begin an interaction and return its identifier',
      inputSchema: z.object({
        purpose: z.string(),
        parties: z.array(z.string()),
        taskCategory: z.string(),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      if (binding && !input.parties.includes(binding.agent.agentId))
        throw new Error('Interaction parties must include the agent bound to this installation');
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
      title: 'Record signed event',
      description: 'Validate and record a signed structured event',
      inputSchema: InteractionEventSchema,
      annotations: { ...WRITE_TOOL, idempotentHint: true },
    },
    async (input, context) => {
      await requireBoundAgent(context, input.agentId);
      const engine = await resolveEngine(context);
      const event = engine.recordEvent(input);
      await persist(context, 'event', event.eventId, event);
      return text(event);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[6],
    {
      title: 'Check factual claim',
      description: 'Check an objective factual claim',
      inputSchema: z.object({ claim: z.string(), permission: z.boolean().optional() }),
      annotations: { ...READ_ONLY_TOOL, openWorldHint: true },
    },
    async (input) => text(await factChecker.check(input.claim, input.permission)),
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[7],
    {
      title: 'Validate commitment',
      description: 'Check whether a commitment is represented by a signed event',
      inputSchema: z.object({ interactionId: z.string().uuid(), commitment: z.string() }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      await requireBoundAgent(context);
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
      title: 'Suggest dispute resolution',
      description: 'Suggest attributable resolutions for a consented conflict',
      inputSchema: z.object({ conflictId: z.string() }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      const engine = await resolveEngine(context);
      const conflict = engine.conflicts.get(input.conflictId);
      if (binding && (!conflict || !(binding.agent.agentId in conflict.permissions)))
        throw new Error('The bound agent is not a participant in this dispute');
      return text(engine.conflicts.get(input.conflictId)?.possibleResolutions ?? []);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[9],
    {
      title: 'Complete interaction',
      description: 'Submit a signed completion receipt',
      inputSchema: ReceiptSchema,
      annotations: { ...WRITE_TOOL, idempotentHint: true },
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      if (binding && !input.participants.includes(binding.agent.agentId))
        throw new Error('Receipt participants must include the bound agent');
      const engine = await resolveEngine(context);
      const receipt = engine.submitReceipt(input);
      await persist(context, 'receipt', receipt.receiptId, receipt);
      return text(receipt);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[10],
    {
      title: 'Submit bilateral feedback',
      description: 'Submit receipt-backed structured feedback',
      inputSchema: FeedbackSchema,
      annotations: { ...WRITE_TOOL, idempotentHint: true },
    },
    async (input, context) => {
      await requireBoundAgent(context, input.reviewerAgentId);
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
      title: 'Raise dispute',
      description: 'Create a mutually consented dispute',
      inputSchema: z.object({
        interactionId: z.string().uuid(),
        issue: z.string(),
        participants: z.array(z.string()).min(2),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      if (binding && !input.participants.includes(binding.agent.agentId))
        throw new Error('Dispute participants must include the bound agent');
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
    {
      title: 'Verify receipt',
      description: 'Verify a signed interaction receipt',
      inputSchema: ReceiptSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      await requireBoundAgent(context);
      const engine = await resolveEngine(context);
      try {
        engine.verifyReceipt(input);
        return text({ valid: true });
      } catch {
        return text({ valid: false });
      }
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[13],
    {
      title: 'Set up this agent',
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
      annotations: WRITE_TOOL,
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
      title: 'Get my agent identity',
      description:
        'Return the agent identity automatically bound to this authenticated MCP installation.',
      inputSchema: z.object({}),
      annotations: READ_ONLY_TOOL,
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
      title: 'Switch agent identity',
      description:
        'Request that this MCP installation switch to another existing agent. Dashboard confirmation is required.',
      inputSchema: z.object({ existingAgentId: z.string().min(1) }),
      annotations: WRITE_TOOL,
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
      title: 'Update my agent profile',
      description: 'Update the profile of the agent bound to this MCP installation.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100).optional(),
        framework: z.string().trim().min(1).max(100).optional(),
        capabilities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
        limitations: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
      }),
      annotations: WRITE_TOOL,
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
      title: 'Check OpenClasp connection',
      description:
        'Check whether this MCP installation is unbound, awaiting confirmation, or connected.',
      inputSchema: z.object({}),
      annotations: READ_ONLY_TOOL,
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
  server.registerTool(
    OPENCLASP_TOOL_NAMES[18],
    {
      title: 'Register delegation',
      description: 'Register and verify a signed, scoped delegation between two known agents.',
      inputSchema: DelegationCredentialSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      if (
        binding &&
        input.parentAgentId !== binding.agent.agentId &&
        input.childAgentId !== binding.agent.agentId
      )
        throw new Error('The bound agent is not a party to this delegation');
      const engine = await resolveEngine(context);
      engine.delegations.set(input.delegationId, input);
      if (!engine.verifyDelegation(input.delegationId)) {
        engine.delegations.delete(input.delegationId);
        throw new Error('Delegation verification failed');
      }
      await persist(context, 'delegation', input.delegationId, input);
      return text({ valid: true, delegation: input });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[19],
    {
      title: 'Save signed agreement',
      description:
        'Verify and save a complete interaction contract signed by every participating agent.',
      inputSchema: InteractionContractSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      if (binding && !input.parties.includes(binding.agent.agentId))
        throw new Error('Contract parties must include the bound agent');
      const contract = (await resolveEngine(context)).saveContract(input);
      await persist(context, 'contract', contract.interactionId, contract);
      return text(contract);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[20],
    {
      title: 'Consent to mediation',
      description:
        "Record the bound agent's explicit consent to mediation for a dispute it participates in.",
      inputSchema: z.object({ conflictId: z.string(), agentId: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      const agentId = binding?.agent.agentId ?? input.agentId;
      if (!agentId) throw new Error('agentId is required for local MCP');
      const engine = await resolveEngine(context);
      const conflict = engine.permitMediation(input.conflictId, agentId);
      await persist(context, 'conflict', conflict.conflictId, conflict);
      return text(conflict);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[21],
    {
      title: 'Resolve mediated dispute',
      description:
        'Save an agreed resolution only after every dispute participant has consented to mediation.',
      inputSchema: z.object({ conflictId: z.string(), resolution: z.string().trim().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input, context) => {
      const binding = await requireBoundAgent(context);
      const engine = await resolveEngine(context);
      const existing = engine.conflicts.get(input.conflictId);
      if (binding && (!existing || !(binding.agent.agentId in existing.permissions)))
        throw new Error('The bound agent is not a participant in this dispute');
      const conflict = engine.resolveConflict(input.conflictId, input.resolution);
      await persist(context, 'conflict', conflict.conflictId, conflict);
      return text(conflict);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[22],
    {
      title: 'Find published agent',
      description:
        'Find an exact owner-published agent card. Returns capabilities and limitations, never owner or conversation data.',
      inputSchema: z.object({ agentId: z.string().min(1) }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      await requireBoundAgent(context);
      if (!agentDirectory) throw new Error('The shared agent directory is not configured');
      return text((await agentDirectory.getPublishedAgent(input.agentId)) ?? { found: false });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[23],
    {
      title: 'Search published agents',
      description:
        'Search owner-published agent cards by name, framework, or capability without exposing owner identities or projects.',
      inputSchema: z.object({
        query: z.string().trim().max(100).optional(),
        capability: z.string().trim().max(100).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      await requireBoundAgent(context);
      if (!agentDirectory) throw new Error('The shared agent directory is not configured');
      return text(await agentDirectory.searchPublishedAgents(input));
    },
  );
  return server;
}
