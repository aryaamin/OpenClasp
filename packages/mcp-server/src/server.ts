import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createIdentity, FixtureFactCheckProvider, TrustEngine } from '../../core/src/index.js';
import {
  AgentIdentitySchema,
  DEFAULT_EXTENSION_URI,
  DelegationCredentialSchema,
  FeedbackSchema,
  InteractionContractSchema,
  InteractionCompletionReportSchema,
  InteractionFeedbackSchema,
  InteractionEventSchema,
  LiveSessionEventSchema,
  ProgressCheckpointSchema,
  ReceiptSchema,
  TrustEnvelopeSchema,
  canonicalHash,
  type FederatedInteraction,
  type PublicAgentCard,
} from '../../protocol/src/index.js';
import {
  requestAgentSetup,
  resolveInstallation,
  updateAgentProfile,
  type OnboardingStore,
} from '../../persistence/src/onboarding.js';
import { buildPublicAgentCard } from '../../persistence/src/hosted.js';

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
  'openclasp_connect_to_agent',
  'openclasp_list_invitations',
  'openclasp_respond_invitation',
  'openclasp_get_shared_interaction',
  'openclasp_get_live_session',
  'openclasp_record_session_event',
  'openclasp_complete_live_session',
  'openclasp_heartbeat',
  'openclasp_list_threads',
  'openclasp_get_thread',
  'openclasp_send_message',
  'openclasp_reply',
  'openclasp_mark_read',
  'openclasp_close_thread',
  'openclasp_submit_completion_report',
  'openclasp_list_feedback_requests',
  'openclasp_submit_interaction_feedback',
  'openclasp_checkpoint',
  'openclasp_resolve_agent',
  'openclasp_propose_contract_revision',
  'openclasp_respond_contract_revision',
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

const LiveSessionEventInputSchema = z
  .object({
    interactionId: LiveSessionEventSchema.shape.interactionId,
    sequence: LiveSessionEventSchema.shape.sequence,
    type: LiveSessionEventSchema.shape.type,
    occurredAt: LiveSessionEventSchema.shape.occurredAt,
    messageHash: LiveSessionEventSchema.shape.messageHash,
    evidenceReferences: LiveSessionEventSchema.shape.evidenceReferences,
    outcome: LiveSessionEventSchema.shape.outcome,
    checkpoint: LiveSessionEventSchema.shape.checkpoint,
    details: LiveSessionEventSchema.shape.details,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.type === 'progress_checkpoint' && !event.checkpoint)
      context.addIssue({
        code: 'custom',
        path: ['checkpoint'],
        message: 'Progress checkpoint events require structured checkpoint data',
      });
    if (event.type !== 'progress_checkpoint' && event.checkpoint)
      context.addIssue({
        code: 'custom',
        path: ['checkpoint'],
        message: 'Checkpoint data is only valid on progress checkpoint events',
      });
  });

export const OPENCLASP_MCP_INSTRUCTIONS =
  'Start with openclasp_connection_status; heartbeat while active. Resolve agent references with openclasp_resolve_agent. Persistent runtimes use direct A2A; temporary agents use hosted threads. Use contract revision tools for high-stakes terms or amendments. For long tasks call openclasp_checkpoint every five exchanges or when blocked, drifting, or nearly done. At a terminal outcome call openclasp_complete_live_session with honest structured feedback. Never upload transcripts or invent evidence or feedback.';

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
type AgentDirectory = {
  publishAgent?(operatorId: string, card: PublicAgentCard): Promise<PublicAgentCard>;
  getPublishedAgent(agentId: string): Promise<PublicAgentCard | undefined>;
  resolveAgentReference?(reference: string): Promise<any | undefined>;
  searchPublishedAgents(input: {
    query?: string | undefined;
    capability?: string | undefined;
    limit?: number | undefined;
  }): Promise<PublicAgentCard[]>;
  createFederatedInteraction(
    operatorId: string,
    value: FederatedInteraction,
  ): Promise<FederatedInteraction>;
  listFederatedInteractions(operatorId: string): Promise<FederatedInteraction[]>;
  getFederatedInteraction(
    operatorId: string,
    interactionId: string,
  ): Promise<FederatedInteraction | undefined>;
  respondToFederatedInteraction(
    operatorId: string,
    interactionId: string,
    agentId: string,
    decision: 'accept' | 'reject',
    method?: 'oauth_installation' | 'oauth_account' | 'policy_auto_accept',
  ): Promise<FederatedInteraction>;
  proposeContractRevision?(
    operatorId: string,
    interactionId: string,
    agentId: string,
    contract: z.infer<typeof InteractionContractSchema>,
    expectedTermsHash?: string,
    method?: 'oauth_installation' | 'oauth_account',
  ): Promise<FederatedInteraction>;
  respondToContractRevision?(
    operatorId: string,
    interactionId: string,
    agentId: string,
    revisionId: string,
    decision: 'accept' | 'reject',
    method?: 'oauth_installation' | 'oauth_account',
  ): Promise<FederatedInteraction>;
  getLiveSession(operatorId: string, interactionId: string, agentId: string): Promise<any>;
  recordLiveSessionEvent(
    token: string,
    event: z.infer<typeof LiveSessionEventSchema>,
  ): Promise<unknown>;
  submitCompletionReport?(
    operatorId: string,
    agentId: string,
    report: z.infer<typeof InteractionCompletionReportSchema>,
    submissionMethod: 'oauth_installation' | 'agent_access_token' | 'runtime_session',
  ): Promise<unknown>;
  listFeedbackRequests?(operatorId: string, agentId: string): Promise<unknown[]>;
  submitInteractionFeedback?(
    operatorId: string,
    agentId: string,
    feedback: z.infer<typeof InteractionFeedbackSchema>,
    submissionMethod: 'oauth_installation' | 'agent_access_token' | 'runtime_session',
  ): Promise<unknown>;
  touchAgentPresence(operatorId: string, agentId: string): Promise<unknown>;
  listHostedThreads(operatorId: string, agentId: string): Promise<any[]>;
  getHostedThread(operatorId: string, agentId: string, threadId: string): Promise<any>;
  sendTemporaryMessage(
    operatorId: string,
    agentId: string,
    interactionId: string,
    content: string,
  ): Promise<any>;
  markHostedThreadRead(operatorId: string, agentId: string, threadId: string): Promise<any>;
  closeHostedThread(operatorId: string, agentId: string, threadId: string): Promise<any>;
};

function installationContext(context: ToolContext) {
  const operatorId = context.http?.authInfo?.extra?.operatorId;
  const clientId = context.http?.authInfo?.clientId;
  if (typeof operatorId !== 'string' || typeof clientId !== 'string')
    throw new Error('Authenticated MCP installation context is required');
  const boundAgentId = context.http?.authInfo?.extra?.boundAgentId;
  const credentialType = context.http?.authInfo?.extra?.credentialType;
  return {
    operatorId,
    clientId,
    ...(typeof boundAgentId === 'string' ? { boundAgentId } : {}),
    ...(typeof credentialType === 'string' ? { credentialType } : {}),
  };
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

  const resolveAuthenticatedInstallation = async (context: ToolContext) => {
    if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
    const connection = installationContext(context);
    const binding = await resolveInstallation(
      onboardingStore,
      connection.operatorId,
      connection.clientId,
    );
    if (
      connection.boundAgentId &&
      (binding.status !== 'connected' || binding.agent.agentId !== connection.boundAgentId)
    )
      throw new Error('Agent access token binding is invalid');
    return { connection, binding };
  };

  const requireBoundAgent = async (context: ToolContext, claimedAgentId?: string) => {
    if (!onboardingStore) return undefined;
    const { connection, binding } = await resolveAuthenticatedInstallation(context);
    if (binding.status !== 'connected')
      throw new Error('Call openclasp_setup and obtain owner confirmation before using this tool');
    if (claimedAgentId && binding.agent.agentId !== claimedAgentId)
      throw new Error('The claimed agent does not match this MCP installation');
    if (agentDirectory)
      await agentDirectory.touchAgentPresence(connection.operatorId, binding.agent.agentId);
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
        'Propose this installation and safe automation policy. Temporary chats receive an OpenClasp-hosted A2A endpoint; persistent agents connect their own runtime.',
      inputSchema: z
        .object({
          agentName: z.string().trim().min(1).max(100),
          projectName: z.string().trim().min(1).max(100).optional(),
          projectId: z.string().optional(),
          framework: z.string().trim().max(100).optional(),
          description: z.string().trim().max(500).optional(),
          agentVersion: z.string().trim().min(1).max(100).optional(),
          agentMode: z.enum(['persistent_runtime', 'temporary_chat']).optional(),
          autoPublish: z.boolean().optional(),
          autoAcceptPolicy: z.enum(['off', 'safe_matching']).optional(),
          autoAcceptTaskCategories: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
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
      const { connection, binding: current } = await resolveAuthenticatedInstallation(context);
      if (current.status === 'connected') {
        await agentDirectory?.touchAgentPresence(connection.operatorId, current.agent.agentId);
        return text(current);
      }
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
      const { connection, binding } = await resolveAuthenticatedInstallation(context);
      if (binding.status === 'connected')
        await agentDirectory?.touchAgentPresence(connection.operatorId, binding.agent.agentId);
      return text(binding);
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
      if (connection.credentialType === 'agent_access_token')
        throw new Error('Agent access tokens cannot switch agent identity');
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
        description: z.string().trim().max(500).optional(),
        agentVersion: z.string().trim().min(1).max(100).optional(),
        agentMode: z.enum(['persistent_runtime', 'temporary_chat']).optional(),
        autoPublish: z.boolean().optional(),
        autoAcceptPolicy: z.enum(['off', 'safe_matching']).optional(),
        autoAcceptTaskCategories: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
        capabilities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
        limitations: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const { connection } = await resolveAuthenticatedInstallation(context);
      const agent = await updateAgentProfile(
        onboardingStore,
        connection.operatorId,
        connection.clientId,
        input,
      );
      const published = await agentDirectory?.getPublishedAgent(agent.agentId);
      if (published && agentDirectory?.publishAgent)
        await agentDirectory.publishAgent(
          connection.operatorId,
          buildPublicAgentCard(
            agent,
            process.env.OPENCLASP_PUBLIC_URL ??
              process.env.OPENCLASP_DASHBOARD_URL ??
              'https://openclasp.vercel.app',
            published,
          ),
        );
      return text(agent);
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
      const { connection, binding } = await resolveAuthenticatedInstallation(context);
      if (binding.status === 'connected') {
        await agentDirectory?.touchAgentPresence(connection.operatorId, binding.agent.agentId);
        return text(binding);
      }
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
  server.registerTool(
    OPENCLASP_TOOL_NAMES[24],
    {
      title: 'Automatically connect to another agent',
      description:
        'Infer safe contract defaults, auto-activate when the responder policy permits, and return a ready-to-send A2A request.',
      inputSchema: z
        .object({
          targetAgentId: z.string().min(1).optional(),
          targetAgentReference: z.string().trim().min(1).max(2048).optional(),
          targetAgentCardUrl: z.string().url().optional(),
          task: z.string().trim().min(1).max(2000).optional(),
          purpose: z.string().trim().min(1).max(500).optional(),
          taskCategory: z.string().trim().min(1).max(100).optional(),
          requestedOutcome: z.string().trim().min(1).max(1000).optional(),
          successCriteria: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
          allowedActions: z.array(z.string().trim().min(1)).max(100).default([]),
          prohibitedActions: z.array(z.string().trim().min(1)).max(100).default([]),
          allowedData: z.array(z.string().trim().min(1)).max(100).default([]),
          prohibitedData: z.array(z.string().trim().min(1)).max(100).default([]),
          evidenceRequirements: z.array(z.string().trim().min(1)).max(100).default([]),
          deadline: z.string().datetime().optional(),
          expiresInMinutes: z.number().int().min(5).max(10080).default(60),
        })
        .superRefine((value, context) => {
          if (!value.targetAgentId && !value.targetAgentReference && !value.targetAgentCardUrl)
            context.addIssue({
              code: 'custom',
              message: 'targetAgentId, targetAgentReference, or targetAgentCardUrl is required',
            });
          if (!value.task && !value.purpose)
            context.addIssue({ code: 'custom', message: 'task or purpose is required' });
        }),
      annotations: { ...WRITE_TOOL, openWorldHint: true },
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Federated agent connections are not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A hosted, bound MCP installation is required');
      const connection = installationContext(context);
      let initiatorCard = await agentDirectory.getPublishedAgent(binding.agent.agentId);
      if (!initiatorCard && binding.agent.autoPublish && agentDirectory.publishAgent)
        initiatorCard = await agentDirectory.publishAgent(
          connection.operatorId,
          buildPublicAgentCard(
            binding.agent,
            process.env.OPENCLASP_PUBLIC_URL ??
              process.env.OPENCLASP_DASHBOARD_URL ??
              'https://openclasp.vercel.app',
          ),
        );
      if (!initiatorCard)
        throw new Error(
          'This agent is private. Enable automatic publishing once in its dashboard settings.',
        );
      let targetAgentId = input.targetAgentId;
      let resolvedResponderCard: PublicAgentCard | undefined;
      if (!targetAgentId && input.targetAgentReference) {
        if (!agentDirectory.resolveAgentReference)
          throw new Error('Agent reference resolution is not configured');
        const resolution = await agentDirectory.resolveAgentReference(input.targetAgentReference);
        resolvedResponderCard = resolution?.card as PublicAgentCard | undefined;
        targetAgentId = resolvedResponderCard?.agentId;
      }
      if (!targetAgentId && input.targetAgentCardUrl) {
        const cardUrl = new URL(input.targetAgentCardUrl);
        const trustedOrigin = new URL(
          process.env.OPENCLASP_DASHBOARD_URL ?? 'https://openclasp.vercel.app',
        ).origin;
        const match = cardUrl.pathname.match(/^\/agents\/([^/]+)\/card\.json$/);
        if (cardUrl.origin !== trustedOrigin || !match?.[1])
          throw new Error('Only OpenClasp-hosted Agent Card URLs are accepted');
        targetAgentId = decodeURIComponent(match[1]);
      }
      if (!targetAgentId) throw new Error('Target agent is required');
      const responderCard =
        resolvedResponderCard ?? (await agentDirectory.getPublishedAgent(targetAgentId));
      if (!responderCard) throw new Error('Target agent is not published on OpenClasp');
      if (
        initiatorCard.agentMode === 'temporary_chat' &&
        responderCard.agentMode === 'temporary_chat'
      )
        throw new Error('Temporary-to-temporary conversations are not supported in this MVP');
      const responderTransport = responderCard.transports[0];
      if (!responderTransport) throw new Error('Target agent has not published an A2A endpoint');
      const task = input.task ?? input.purpose!;
      const purpose = input.purpose ?? task.slice(0, 500);
      const taskCategory = input.taskCategory ?? responderCard.capabilities[0] ?? 'general';
      const requestedOutcome = input.requestedOutcome ?? task.slice(0, 1000);
      const successCriteria = input.successCriteria ?? [
        'Return a clear result that directly addresses the requested task',
      ];
      const existing = (await agentDirectory.listFederatedInteractions(connection.operatorId)).find(
        (candidate) =>
          candidate.initiatorAgentId === binding.agent.agentId &&
          candidate.responderAgentId === responderCard.agentId &&
          ['pending', 'active'].includes(candidate.status) &&
          candidate.contract.purpose === purpose &&
          candidate.contract.taskCategory === taskCategory &&
          candidate.contract.requestedOutcome === requestedOutcome &&
          JSON.stringify(candidate.contract.successCriteria) === JSON.stringify(successCriteria) &&
          JSON.stringify(candidate.contract.allowedActions) ===
            JSON.stringify(input.allowedActions) &&
          JSON.stringify(candidate.contract.prohibitedActions) ===
            JSON.stringify(input.prohibitedActions) &&
          JSON.stringify(candidate.contract.allowedData) === JSON.stringify(input.allowedData) &&
          JSON.stringify(candidate.contract.prohibitedData) ===
            JSON.stringify(input.prohibitedData) &&
          JSON.stringify(candidate.contract.evidenceRequirements) ===
            JSON.stringify(input.evidenceRequirements) &&
          candidate.contract.deadline === input.deadline,
      );
      const now = new Date();
      const interactionId = existing?.interactionId ?? crypto.randomUUID();
      const contract = {
        protocolVersion: '0.1' as const,
        interactionId,
        purpose,
        parties: [binding.agent.agentId, responderCard.agentId],
        taskCategory,
        requestedOutcome,
        successCriteria,
        allowedActions: input.allowedActions,
        prohibitedActions: input.prohibitedActions,
        allowedData: input.allowedData,
        prohibitedData: input.prohibitedData,
        ...(input.deadline ? { deadline: input.deadline } : {}),
        evidenceRequirements: input.evidenceRequirements,
        delegationRules: ['explicit_contract_scope'],
        humanApprovalRequirements: [],
        factCheckingPolicy: 'important_claims',
        mediationPolicy: 'mutual_consent' as const,
        retentionDays: 30,
        completionConditions: successCriteria,
        cancellationConditions: ['either_party_before_completion'],
        signatures: {},
      };
      const termsHash = existing?.termsHash ?? canonicalHash(contract);
      const createdAt = now.toISOString();
      const interaction: FederatedInteraction = {
        protocolVersion: '0.1',
        interactionId,
        initiatorAgentId: binding.agent.agentId,
        responderAgentId: responderCard.agentId,
        status: 'pending',
        contract,
        termsHash,
        acceptances: {
          [binding.agent.agentId]: {
            agentId: binding.agent.agentId,
            method: 'oauth_installation',
            termsHash,
            acceptedAt: createdAt,
          },
        },
        contractRevision: 1,
        contractRevisions: [],
        ...(initiatorCard.transports[0] ? { initiatorTransport: initiatorCard.transports[0] } : {}),
        responderTransport,
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000).toISOString(),
      };
      const stored =
        existing ??
        (await agentDirectory.createFederatedInteraction(connection.operatorId, interaction));
      const session =
        stored.status === 'active'
          ? await agentDirectory.getLiveSession(
              connection.operatorId,
              stored.interactionId,
              binding.agent.agentId,
            )
          : undefined;
      return text({
        ready: stored.status === 'active',
        session,
        interaction: stored,
        a2a: {
          endpoint: session?.peer.endpoint,
          bearerToken: session?.peer.bearerToken,
          protocolBinding: stored.responderTransport.protocolBinding,
          extensions: [DEFAULT_EXTENSION_URI],
          metadata: {
            [DEFAULT_EXTENSION_URI]: {
              interactionId: stored.interactionId,
              termsHash: stored.termsHash,
              initiatorAgentId: stored.initiatorAgentId,
              responderAgentId: stored.responderAgentId,
            },
          },
          requestTemplate: {
            method: 'message/send',
            headers: { 'A2A-Extensions': DEFAULT_EXTENSION_URI },
            message: {
              role: 'user',
              parts: [{ kind: 'text', text: task }],
              metadata: {
                [DEFAULT_EXTENSION_URI]: {
                  interactionId: stored.interactionId,
                  termsHash: stored.termsHash,
                  initiatorAgentId: stored.initiatorAgentId,
                  responderAgentId: stored.responderAgentId,
                },
              },
            },
          },
        },
        next:
          stored.status === 'active'
            ? 'Both live runtimes accepted. Send the A2A request directly to session.peer.endpoint; OpenClasp is not in the message path.'
            : `The task needs responder approval. OpenClasp will expose it at ${process.env.OPENCLASP_DASHBOARD_URL ?? 'https://openclasp.vercel.app'}/dashboard; retry this interaction after approval.`,
      });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[25],
    {
      title: 'List shared invitations',
      description: 'List incoming and outgoing cross-account interaction invitations and status.',
      inputSchema: z.object({}),
      annotations: READ_ONLY_TOOL,
    },
    async (_input, context) => {
      if (!agentDirectory) throw new Error('Federated agent connections are not configured');
      await requireBoundAgent(context);
      const connection = installationContext(context);
      return text(await agentDirectory.listFederatedInteractions(connection.operatorId));
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[26],
    {
      title: 'Respond to agent invitation',
      description: 'Accept or reject an invitation as the agent bound to this MCP installation.',
      inputSchema: z.object({
        interactionId: z.string().uuid(),
        decision: z.enum(['accept', 'reject']),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Federated agent connections are not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A hosted, bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.respondToFederatedInteraction(
          connection.operatorId,
          input.interactionId,
          binding.agent.agentId,
          input.decision,
          'oauth_installation',
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[27],
    {
      title: 'Get shared interaction',
      description: 'Get the canonical contract and bilateral acceptance state for one interaction.',
      inputSchema: z.object({ interactionId: z.string().uuid() }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Federated agent connections are not configured');
      await requireBoundAgent(context);
      const connection = installationContext(context);
      const value = await agentDirectory.getFederatedInteraction(
        connection.operatorId,
        input.interactionId,
      );
      if (!value) throw new Error('Interaction not found');
      return text(value);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[28],
    {
      title: 'Get direct live session',
      description:
        'Get the peer A2A endpoint and short-lived credential for a brokered live session.',
      inputSchema: z.object({ interactionId: z.string().uuid() }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Live agent sessions are not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.getLiveSession(
          connection.operatorId,
          input.interactionId,
          binding.agent.agentId,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[29],
    {
      title: 'Record structured session event',
      description:
        'Record signed session metadata, hashes, evidence, corrections, or results without uploading raw messages.',
      inputSchema: LiveSessionEventInputSchema,
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Live agent sessions are not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      const session = await agentDirectory.getLiveSession(
        connection.operatorId,
        input.interactionId,
        binding.agent.agentId,
      );
      return text(
        await agentDirectory.recordLiveSessionEvent(session.reporting.bearerToken, {
          ...input,
          eventId: crypto.randomUUID(),
          agentId: binding.agent.agentId,
        }),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[30],
    {
      title: 'Complete live session',
      description:
        'Finalize this participant’s side of a live session. Records the terminal event and submits a structured completion report, which triggers the persistent peer’s private finalization. Optional assessment and feedback improve the resulting reliability history.',
      inputSchema: z
        .object({
          interactionId: z.string().uuid(),
          sequence: z.number().int().nonnegative(),
          outcome: z.enum(['success', 'failure', 'partial']),
          evidenceReferences: z.array(z.string().min(1).max(2048)).max(100).default([]),
          details: LiveSessionEventSchema.shape.details,
          assessment: z
            .object({
              summary: z.string().min(1).max(2000),
              criteria: z
                .array(
                  z
                    .object({
                      criterion: z.string().min(1).max(1000),
                      status: z.enum(['met', 'partially_met', 'missed', 'unknown']),
                      explanation: z.string().max(1000).optional(),
                      evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
                    })
                    .strict(),
                )
                .max(100)
                .default([]),
              deliverables: z.array(z.string().min(1).max(1000)).max(100).default([]),
              actionsTaken: z.array(z.string().min(1).max(1000)).max(100).default([]),
              blockers: z.array(z.string().min(1).max(1000)).max(100).default([]),
              corrections: z.array(z.string().min(1).max(1000)).max(100).default([]),
              confidence: z.number().min(0).max(1),
            })
            .strict()
            .optional(),
          feedback: z
            .object({
              ratings: z
                .object({
                  overall_satisfaction: z.number().min(0).max(1),
                  outcome_satisfaction: z.number().min(0).max(1),
                  communication: z.number().min(0).max(1),
                  timeliness: z.number().min(0).max(1),
                  scope_adherence: z.number().min(0).max(1),
                  evidence_quality: z.number().min(0).max(1),
                  correction_handling: z.number().min(0).max(1),
                  reliability: z.number().min(0).max(1),
                })
                .strict(),
              wouldWorkAgain: z.enum(['yes', 'no', 'unsure']),
              reasonCodes: z.array(z.string().min(1).max(128)).max(32).default([]),
              privateComment: z.string().max(1000).optional(),
              confidence: z.number().min(0).max(1),
            })
            .strict()
            .optional(),
        })
        .strict(),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory?.submitCompletionReport)
        throw new Error('Live agent session completion is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      const session = await agentDirectory.getLiveSession(
        connection.operatorId,
        input.interactionId,
        binding.agent.agentId,
      );
      const interaction = await agentDirectory.getFederatedInteraction(
        connection.operatorId,
        input.interactionId,
      );
      if (!interaction || !interaction.contract.parties.includes(binding.agent.agentId))
        throw new Error('Bound agent is not an interaction participant');
      const counterpartyAgentId =
        interaction.initiatorAgentId === binding.agent.agentId
          ? interaction.responderAgentId
          : interaction.initiatorAgentId;
      const occurredAt = new Date().toISOString();
      const event = await agentDirectory.recordLiveSessionEvent(session.reporting.bearerToken, {
        eventId: crypto.randomUUID(),
        interactionId: input.interactionId,
        agentId: binding.agent.agentId,
        sequence: input.sequence,
        type: input.outcome === 'failure' ? 'session_failed' : 'session_completed',
        occurredAt,
        evidenceReferences: input.evidenceReferences,
        outcome: input.outcome,
        details: input.details,
      });
      const suppliedCriteria = input.assessment?.criteria ?? [];
      const report = InteractionCompletionReportSchema.parse({
        reportId: crypto.randomUUID(),
        interactionId: input.interactionId,
        contractHash: interaction.termsHash,
        reportingAgentId: binding.agent.agentId,
        counterpartyAgentId,
        agentVersion: binding.agent.agentVersion,
        outcome: input.outcome,
        summary:
          input.assessment?.summary ??
          `The agent reported this live session as ${input.outcome}. Detailed assessment was not supplied by the MCP client.`,
        requestedOutcome: interaction.contract.requestedOutcome,
        criteria: interaction.contract.successCriteria.map(
          (criterion) =>
            suppliedCriteria.find((candidate) => candidate.criterion === criterion) ?? {
              criterion,
              status: 'unknown',
              evidenceReferences: [],
            },
        ),
        deliverables: input.assessment?.deliverables ?? [],
        actionsTaken: input.assessment?.actionsTaken ?? [],
        blockers: input.assessment?.blockers ?? [],
        scopeChanges: [],
        corrections: input.assessment?.corrections ?? [],
        evidenceReferences: input.evidenceReferences,
        ...(session.activatedAt ? { startedAt: session.activatedAt } : {}),
        completedAt: occurredAt,
        confidence: input.assessment?.confidence ?? 0.25,
        dataSharingMode: 'structured_only',
      });
      const submissionMethod =
        connection.credentialType === 'agent_access_token'
          ? 'agent_access_token'
          : 'oauth_installation';
      const completion = (await agentDirectory.submitCompletionReport(
        connection.operatorId,
        binding.agent.agentId,
        report,
        submissionMethod,
      )) as { feedbackRequest?: { requestId?: string; status?: string } };
      let feedback: unknown;
      if (
        input.feedback &&
        completion.feedbackRequest?.requestId &&
        completion.feedbackRequest.status !== 'submitted' &&
        agentDirectory.submitInteractionFeedback
      ) {
        feedback = await agentDirectory.submitInteractionFeedback(
          connection.operatorId,
          binding.agent.agentId,
          InteractionFeedbackSchema.parse({
            feedbackId: crypto.randomUUID(),
            requestId: completion.feedbackRequest.requestId,
            interactionId: input.interactionId,
            reviewerAgentId: binding.agent.agentId,
            subjectAgentId: counterpartyAgentId,
            reviewerAgentVersion: binding.agent.agentVersion,
            ratings: input.feedback.ratings,
            wouldWorkAgain: input.feedback.wouldWorkAgain,
            reasonCodes: input.feedback.reasonCodes,
            ...(input.feedback.privateComment
              ? { privateComment: input.feedback.privateComment }
              : {}),
            evidenceReferences: input.evidenceReferences,
            confidence: input.feedback.confidence,
            submittedAt: occurredAt,
          }),
          submissionMethod,
        );
      }
      return text({ event, completion, ...(feedback ? { feedback } : {}) });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[31],
    {
      title: 'Heartbeat agent presence',
      description:
        'Mark this authenticated agent online. Online means activity within the last two minutes.',
      inputSchema: z.object({}),
      annotations: { ...WRITE_TOOL, idempotentHint: true },
    },
    async (_input, context) => {
      if (!agentDirectory) throw new Error('Hosted agent presence is not configured');
      if (!onboardingStore) throw new Error('Hosted agent onboarding is not configured');
      const { connection, binding } = await resolveAuthenticatedInstallation(context);
      if (binding.status !== 'connected')
        throw new Error('Call openclasp_setup and obtain owner confirmation first');
      return text({
        agentId: binding.agent.agentId,
        presence: await agentDirectory.touchAgentPresence(
          connection.operatorId,
          binding.agent.agentId,
        ),
      });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[41],
    {
      title: 'Checkpoint interaction progress',
      description:
        'Send a compact structured progress pulse without raw conversation text. Use after roughly five meaningful exchanges, or immediately when blocked, drifting from scope, or ready to finish.',
      inputSchema: z
        .object({
          interactionId: z.string().uuid(),
          sequence: z.number().int().nonnegative(),
          checkpoint: ProgressCheckpointSchema,
        })
        .strict(),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Live agent sessions are not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      const session = await agentDirectory.getLiveSession(
        connection.operatorId,
        input.interactionId,
        binding.agent.agentId,
      );
      const result = await agentDirectory.recordLiveSessionEvent(session.reporting.bearerToken, {
        eventId: crypto.randomUUID(),
        interactionId: input.interactionId,
        agentId: binding.agent.agentId,
        sequence: input.sequence,
        type: 'progress_checkpoint',
        occurredAt: new Date().toISOString(),
        evidenceReferences: [],
        checkpoint: input.checkpoint,
        details: {
          labels: [`state:${input.checkpoint.state}`, `topic:${input.checkpoint.topicStatus}`],
          metrics: { progress: input.checkpoint.progress, confidence: input.checkpoint.confidence },
          flags: { needsHuman: input.checkpoint.needsHuman },
        },
      });
      return text({
        checkpoint: result,
        ...(input.checkpoint.state === 'done' || input.checkpoint.state === 'ready_to_finalize'
          ? { nextAction: 'Call openclasp_complete_live_session now.' }
          : {}),
      });
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[38],
    {
      title: 'Submit structured completion report',
      description:
        'Submit this agent’s structured outcome against the signed interaction contract. Raw messages and transcripts are rejected.',
      inputSchema: z
        .object({
          interactionId: z.string().uuid(),
          outcome: z.enum(['success', 'partial', 'failure', 'cancelled']),
          summary: z.string().min(1).max(2000),
          criteria: z
            .array(
              z
                .object({
                  criterion: z.string().min(1).max(1000),
                  status: z.enum(['met', 'partially_met', 'missed', 'unknown']),
                  explanation: z.string().max(1000).optional(),
                  evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
                })
                .strict(),
            )
            .max(100),
          deliverables: z.array(z.string().min(1).max(1000)).max(100).default([]),
          actionsTaken: z.array(z.string().min(1).max(1000)).max(100).default([]),
          blockers: z.array(z.string().min(1).max(1000)).max(100).default([]),
          scopeChanges: z.array(z.string().min(1).max(1000)).max(100).default([]),
          corrections: z.array(z.string().min(1).max(1000)).max(100).default([]),
          evidenceReferences: z.array(z.string().min(1).max(2048)).max(100).default([]),
          startedAt: z.string().datetime().optional(),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory?.submitCompletionReport)
        throw new Error('Interaction completion is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      const interaction = await agentDirectory.getFederatedInteraction(
        connection.operatorId,
        input.interactionId,
      );
      if (!interaction) throw new Error('Interaction not found');
      const counterpartyAgentId =
        interaction.initiatorAgentId === binding.agent.agentId
          ? interaction.responderAgentId
          : interaction.initiatorAgentId;
      if (!interaction.contract.parties.includes(binding.agent.agentId))
        throw new Error('Bound agent is not an interaction participant');
      const report = InteractionCompletionReportSchema.parse({
        reportId: crypto.randomUUID(),
        interactionId: input.interactionId,
        contractHash: interaction.termsHash,
        reportingAgentId: binding.agent.agentId,
        counterpartyAgentId,
        agentVersion: binding.agent.agentVersion,
        outcome: input.outcome,
        summary: input.summary,
        requestedOutcome: interaction.contract.requestedOutcome,
        criteria: input.criteria,
        deliverables: input.deliverables,
        actionsTaken: input.actionsTaken,
        blockers: input.blockers,
        scopeChanges: input.scopeChanges,
        corrections: input.corrections,
        evidenceReferences: input.evidenceReferences,
        ...(input.startedAt ? { startedAt: input.startedAt } : {}),
        completedAt: new Date().toISOString(),
        confidence: input.confidence,
        dataSharingMode: 'structured_only',
      });
      return text(
        await agentDirectory.submitCompletionReport(
          connection.operatorId,
          binding.agent.agentId,
          report,
          connection.credentialType === 'agent_access_token'
            ? 'agent_access_token'
            : 'oauth_installation',
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[39],
    {
      title: 'List feedback requests',
      description:
        'List this agent’s pending and completed bilateral feedback requests. Peer feedback remains concealed until both respond or the timeout expires.',
      inputSchema: z.object({}),
      annotations: READ_ONLY_TOOL,
    },
    async (_input, context) => {
      if (!agentDirectory?.listFeedbackRequests)
        throw new Error('Interaction feedback is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.listFeedbackRequests(connection.operatorId, binding.agent.agentId),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[40],
    {
      title: 'Submit bilateral interaction feedback',
      description:
        'Rate the counterparty after an interaction. The private comment is never included in the shared aggregate conclusion.',
      inputSchema: z
        .object({
          requestId: z.string().uuid(),
          interactionId: z.string().uuid(),
          ratings: z
            .object({
              overall_satisfaction: z.number().min(0).max(1),
              outcome_satisfaction: z.number().min(0).max(1),
              communication: z.number().min(0).max(1),
              timeliness: z.number().min(0).max(1),
              scope_adherence: z.number().min(0).max(1),
              evidence_quality: z.number().min(0).max(1),
              correction_handling: z.number().min(0).max(1),
              reliability: z.number().min(0).max(1),
            })
            .strict(),
          wouldWorkAgain: z.enum(['yes', 'no', 'unsure']),
          reasonCodes: z.array(z.string().min(1).max(128)).max(32).default([]),
          privateComment: z.string().max(1000).optional(),
          evidenceReferences: z.array(z.string().min(1).max(2048)).max(50).default([]),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory?.submitInteractionFeedback)
        throw new Error('Interaction feedback is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      const interaction = await agentDirectory.getFederatedInteraction(
        connection.operatorId,
        input.interactionId,
      );
      if (!interaction) throw new Error('Interaction not found');
      const subjectAgentId =
        interaction.initiatorAgentId === binding.agent.agentId
          ? interaction.responderAgentId
          : interaction.initiatorAgentId;
      if (!interaction.contract.parties.includes(binding.agent.agentId))
        throw new Error('Bound agent is not an interaction participant');
      const feedback = InteractionFeedbackSchema.parse({
        feedbackId: crypto.randomUUID(),
        requestId: input.requestId,
        interactionId: input.interactionId,
        reviewerAgentId: binding.agent.agentId,
        subjectAgentId,
        reviewerAgentVersion: binding.agent.agentVersion,
        ratings: input.ratings,
        wouldWorkAgain: input.wouldWorkAgain,
        reasonCodes: input.reasonCodes,
        ...(input.privateComment ? { privateComment: input.privateComment } : {}),
        evidenceReferences: input.evidenceReferences,
        confidence: input.confidence,
        submittedAt: new Date().toISOString(),
      });
      return text(
        await agentDirectory.submitInteractionFeedback(
          connection.operatorId,
          binding.agent.agentId,
          feedback,
          connection.credentialType === 'agent_access_token'
            ? 'agent_access_token'
            : 'oauth_installation',
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[32],
    {
      title: 'List temporary chat threads',
      description:
        'List hosted threads for this temporary chat identity. Message bodies are encrypted at rest and never mixed with direct A2A sessions.',
      inputSchema: z.object({}),
      annotations: READ_ONLY_TOOL,
    },
    async (_input, context) => {
      if (!agentDirectory) throw new Error('Temporary chat history is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.listHostedThreads(connection.operatorId, binding.agent.agentId),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[33],
    {
      title: 'Get temporary chat thread',
      description:
        'Read one hosted temporary-agent thread plus private, task-specific counterparty insights.',
      inputSchema: z.object({ threadId: z.string().uuid() }),
      annotations: READ_ONLY_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Temporary chat history is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.getHostedThread(
          connection.operatorId,
          binding.agent.agentId,
          input.threadId,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[34],
    {
      title: 'Send from temporary chat',
      description:
        'Send text from this temporary identity to the persistent peer over A2A. OpenClasp processes and encrypts this hosted-mode message.',
      inputSchema: z.object({
        interactionId: z.string().uuid(),
        content: z.string().trim().min(1).max(20_000),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Temporary chat delivery is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.sendTemporaryMessage(
          connection.operatorId,
          binding.agent.agentId,
          input.interactionId,
          input.content,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[35],
    {
      title: 'Reply to temporary chat thread',
      description: 'Reply to the persistent peer in an existing hosted temporary-agent thread.',
      inputSchema: z.object({
        threadId: z.string().uuid(),
        content: z.string().trim().min(1).max(20_000),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Temporary chat delivery is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      const thread = await agentDirectory.getHostedThread(
        connection.operatorId,
        binding.agent.agentId,
        input.threadId,
      );
      return text(
        await agentDirectory.sendTemporaryMessage(
          connection.operatorId,
          binding.agent.agentId,
          thread.thread.interactionId,
          input.content,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[36],
    {
      title: 'Mark temporary thread read',
      description: 'Mark inbound messages in one hosted temporary-agent thread as read.',
      inputSchema: z.object({ threadId: z.string().uuid() }),
      annotations: { ...WRITE_TOOL, idempotentHint: true },
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Temporary chat history is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.markHostedThreadRead(
          connection.operatorId,
          binding.agent.agentId,
          input.threadId,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[37],
    {
      title: 'Close temporary chat thread',
      description: 'Close a hosted temporary-agent thread. New messages will be rejected.',
      inputSchema: z.object({ threadId: z.string().uuid() }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory) throw new Error('Temporary chat history is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.closeHostedThread(
          connection.operatorId,
          binding.agent.agentId,
          input.threadId,
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[42],
    {
      title: 'Resolve agent reference',
      description:
        'Resolve an OpenClasp profile URL, card URL, A2A card URL, public slug, or agent ID to one verified published agent.',
      inputSchema: z.object({ reference: z.string().trim().min(1).max(2048) }),
      annotations: { ...READ_ONLY_TOOL, openWorldHint: true },
    },
    async (input, context) => {
      await requireBoundAgent(context);
      if (!agentDirectory) throw new Error('The shared agent directory is not configured');
      const resolved = agentDirectory.resolveAgentReference
        ? await agentDirectory.resolveAgentReference(input.reference)
        : await agentDirectory.getPublishedAgent(input.reference);
      if (!resolved) throw new Error('Published agent reference was not found');
      return text(resolved);
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[43],
    {
      title: 'Propose contract revision',
      description:
        'Propose or counter complete structured terms for a pending interaction, or propose an amendment to an active interaction. The proposal is bound to the authenticated agent.',
      inputSchema: z.object({
        interactionId: z.string().uuid(),
        expectedTermsHash: z.string().min(1).optional(),
        contract: InteractionContractSchema,
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory?.proposeContractRevision)
        throw new Error('Contract negotiation is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      if (input.contract.interactionId !== input.interactionId)
        throw new Error('Contract interaction ID does not match');
      const connection = installationContext(context);
      return text(
        await agentDirectory.proposeContractRevision(
          connection.operatorId,
          input.interactionId,
          binding.agent.agentId,
          input.contract,
          input.expectedTermsHash,
          'oauth_installation',
        ),
      );
    },
  );
  server.registerTool(
    OPENCLASP_TOOL_NAMES[44],
    {
      title: 'Respond to contract revision',
      description:
        'Accept or reject the current contract proposal or amendment as the authenticated agent. Bilateral acceptance creates a platform-attested revision.',
      inputSchema: z.object({
        interactionId: z.string().uuid(),
        revisionId: z.string().uuid(),
        decision: z.enum(['accept', 'reject']),
      }),
      annotations: WRITE_TOOL,
    },
    async (input, context) => {
      if (!agentDirectory?.respondToContractRevision)
        throw new Error('Contract negotiation is not configured');
      const binding = await requireBoundAgent(context);
      if (!binding) throw new Error('A bound MCP installation is required');
      const connection = installationContext(context);
      return text(
        await agentDirectory.respondToContractRevision(
          connection.operatorId,
          input.interactionId,
          binding.agent.agentId,
          input.revisionId,
          input.decision,
          'oauth_installation',
        ),
      );
    },
  );
  return server;
}
