export const previewKey = 'openclasp.preview.v1';

export const previewSession = {
  user: {
    sub: 'local-preview',
    name: 'Local preview',
    email: 'preview@localhost',
  },
};

export type DashboardData = {
  agents: Record<string, any>[];
  projects: Record<string, any>[];
  installations: Record<string, any>[];
  setupRequests: Record<string, any>[];
  publications: Record<string, any>[];
  interactions: Record<string, any>[];
  federatedInteractions: Record<string, any>[];
  liveSessions: Record<string, any>[];
  hostedThreads: Record<string, any>[];
  events: Record<string, any>[];
  conflicts: Record<string, any>[];
  receipts: Record<string, any>[];
  profiles: Record<string, any>[];
  runtimes: Record<string, any>[];
  accessTokens: Record<string, any>[];
};

export type Settings = {
  displayName: string;
  contributionEnabled: boolean;
  retentionDays: number;
  evidenceSharing: 'never' | 'ask' | 'contract_only';
  rawConversationsStored: false;
};

export const defaultPreviewSettings: Settings = {
  displayName: 'Local operator',
  contributionEnabled: false,
  retentionDays: 30,
  evidenceSharing: 'ask',
  rawConversationsStored: false,
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export function createPreviewData(): DashboardData {
  return {
    projects: [
      { projectId: 'proj_ops', name: 'Operations', createdAt: ago(21 * 24 * 60) },
      { projectId: 'proj_research', name: 'Research', createdAt: ago(12 * 24 * 60) },
    ],
    agents: [
      {
        agentId: 'agent_atlas',
        projectId: 'proj_research',
        name: 'Atlas Research',
        description: 'Literature review and planning',
        framework: 'Claude',
        agentVersion: '1.4.2',
        agentMode: 'persistent_runtime',
        a2aEndpoint: 'https://atlas.example.com/a2a',
        autoPublish: true,
        autoAcceptPolicy: 'safe_matching',
        autoAcceptTaskCategories: ['research', 'planning'],
        capabilities: ['research', 'planning', 'summarization'],
        limitations: ['no payments'],
        identityMode: 'oauth_installation',
        status: 'active',
        createdAt: ago(12 * 24 * 60),
        updatedAt: ago(8),
        presence: { status: 'online', lastSeenAt: ago(1) },
      },
      {
        agentId: 'agent_harbor',
        projectId: 'proj_ops',
        name: 'Harbor Ops',
        description: 'Incident triage and runbooks',
        framework: 'GPT',
        agentVersion: '2.1.0',
        agentMode: 'temporary_chat',
        autoPublish: false,
        autoAcceptPolicy: 'off',
        autoAcceptTaskCategories: [],
        capabilities: ['ops', 'triage'],
        limitations: ['no production writes'],
        identityMode: 'oauth_installation',
        status: 'active',
        createdAt: ago(21 * 24 * 60),
        updatedAt: ago(180),
        presence: { status: 'offline', lastSeenAt: ago(180) },
      },
    ],
    installations: [
      {
        installationId: 'inst_atlas',
        clientId: 'mcp_atlas',
        agentId: 'agent_atlas',
        projectId: 'proj_research',
        connectedAt: ago(12 * 24 * 60),
        updatedAt: ago(8),
      },
    ],
    setupRequests: [
      {
        requestId: 'setup_lumen',
        clientId: 'mcp_lumen',
        action: 'connect',
        status: 'pending',
        agentName: 'Lumen Writer',
        projectName: 'Content',
        framework: 'Claude',
        agentVersion: '0.9.0',
        autoPublish: true,
        autoAcceptPolicy: 'safe_matching',
        autoAcceptTaskCategories: ['writing', 'editing'],
        capabilities: ['writing', 'editing', 'research'],
        limitations: ['no outbound email'],
        requestedAt: ago(18),
      },
    ],
    publications: [{ agentId: 'agent_atlas', published: true, updatedAt: ago(40) }],
    interactions: [
      {
        interactionId: 'ix_local_brief',
        agentId: 'agent_atlas',
        status: 'completed',
        createdAt: ago(240),
        completedAt: ago(220),
      },
    ],
    federatedInteractions: [
      {
        interactionId: 'ix_shared_review',
        initiatorAgentId: 'agent_peer_nova',
        responderAgentId: 'agent_atlas',
        status: 'pending',
        termsHash: '7f3c91a0b2e84d11c6aa09f1d3e8b470',
        createdAt: ago(26),
        contract: { purpose: 'Review a research brief for scope and sources' },
      },
      {
        interactionId: 'ix_shared_ops',
        initiatorAgentId: 'agent_atlas',
        responderAgentId: 'agent_peer_keel',
        status: 'active',
        termsHash: '12ab44c0e91f77d0aa3310bc44ee9012',
        createdAt: ago(90),
        contract: { purpose: 'Share a sanitized incident timeline' },
        acceptances: {
          agent_peer_keel: { method: 'policy_auto_accept' },
        },
      },
    ],
    liveSessions: [
      {
        interactionId: 'ix_shared_ops',
        initiatorAgentId: 'agent_atlas',
        responderAgentId: 'agent_peer_keel',
        status: 'active',
        createdAt: ago(88),
        activatedAt: ago(87),
        expiresAt: ahead(12),
      },
    ],
    hostedThreads: [],
    events: [
      {
        eventId: 'evt_1',
        eventType: 'interaction_started',
        agentId: 'agent_atlas',
        interactionId: 'ix_shared_ops',
        timestamp: ago(88),
        visibility: 'participants',
      },
      {
        eventId: 'evt_2',
        eventType: 'policy_warning',
        agentId: 'agent_harbor',
        interactionId: 'ix_local_brief',
        timestamp: ago(200),
        visibility: 'owner',
      },
      {
        eventId: 'evt_3',
        eventType: 'claim_checked',
        agentId: 'agent_atlas',
        interactionId: 'ix_local_brief',
        timestamp: ago(230),
        visibility: 'participants',
      },
      {
        eventId: 'evt_4',
        eventType: 'session_activated',
        agentId: 'agent_atlas',
        interactionId: 'ix_shared_ops',
        timestamp: ago(87),
        visibility: 'participants',
      },
    ],
    conflicts: [
      {
        conflictId: 'dsp_1',
        interactionId: 'ix_local_brief',
        status: 'open',
        createdAt: ago(190),
      },
    ],
    receipts: [
      {
        receiptId: 'rcpt_1',
        interactionId: 'ix_local_brief',
        agentId: 'agent_atlas',
        outcome: 'success',
        completedAt: ago(220),
      },
    ],
    profiles: [
      {
        agentId: 'agent_atlas',
        taskCategory: 'research',
        agentVersion: '1.4.2',
        sampleSize: 14,
        completion: 0.92,
        scope: 0.84,
        evidence: 0.88,
        communication: 0.79,
        deadline: 0.9,
      },
      {
        agentId: 'agent_harbor',
        taskCategory: 'ops',
        agentVersion: '2.1.0',
        sampleSize: 6,
        completion: 0.71,
        scope: 0.66,
        evidence: 0.58,
        communication: 0.74,
        deadline: 0.62,
      },
    ],
    runtimes: [
      {
        agentId: 'agent_atlas',
        endpoint: 'https://atlas.example.com/openclasp',
        a2aEndpoint: 'https://atlas.example.com/a2a',
        status: 'verified',
        verifiedAt: ago(40),
      },
    ],
    accessTokens: [],
  };
}

export function applyPreviewRequest(
  data: DashboardData,
  settings: Settings,
  path: string,
  init?: RequestInit,
): { data: DashboardData; settings: Settings; result: unknown } {
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (path === '/v0.1/dashboard' && method === 'GET') return { data, settings, result: data };
  if (path === '/v0.1/settings' && method === 'GET') return { data, settings, result: settings };
  if (path === '/v0.1/settings' && method === 'PUT') {
    const next = {
      ...settings,
      ...body,
      rawConversationsStored: false as const,
    } as Settings;
    return { data, settings: next, result: next };
  }

  if (path === '/v0.1/provider-connections' && method === 'POST') {
    const suffix = crypto.randomUUID();
    const projectName = String(body.projectName ?? 'Hosted agents');
    const existingProject = data.projects.find(
      (project) => String(project.name).toLowerCase() === projectName.toLowerCase(),
    );
    const project = existingProject ?? {
      projectId: `project_${suffix}`,
      name: projectName,
      createdAt: new Date().toISOString(),
    };
    const agentId = `agent_${suffix}`;
    const createdAt = new Date();
    const tokenId = suffix.replaceAll('-', '').slice(0, 16);
    const provider = body.provider === 'custom' ? 'custom' : 'botpress';
    const agent = {
      agentId,
      projectId: project.projectId,
      name: String(body.agentName ?? 'Botpress agent'),
      description: String(body.description ?? ''),
      framework: provider === 'botpress' ? 'Botpress' : 'Custom runtime',
      agentVersion: '1.0.0',
      agentMode: 'persistent_runtime',
      transport: 'direct_a2a',
      autoPublish: false,
      autoAcceptPolicy: 'off',
      autoAcceptTaskCategories: [],
      capabilities: body.capabilities ?? [],
      limitations: body.limitations ?? [],
      identityMode: 'owner_managed',
      status: 'active',
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      presence: { status: 'offline' },
    };
    const accessToken = {
      tokenId,
      token: `oc_at_${tokenId}.preview_agent_access_token_secret_not_for_production`,
      agentId,
      name: provider === 'botpress' ? 'Botpress' : 'Custom runtime',
      scopes: ['mcp:access', 'runtime:connect'],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + Number(body.expiresInDays ?? 365) * 86_400_000,
      ).toISOString(),
    };
    return {
      data: {
        ...data,
        projects: existingProject ? data.projects : [...data.projects, project],
        agents: [...data.agents, agent],
        accessTokens: [accessToken, ...data.accessTokens],
      },
      settings,
      result: { agent, project, provider, accessToken },
    };
  }

  const automation = path.match(/^\/v0\.1\/agents\/([^/]+)\/automation$/);
  if (automation && method === 'PUT') {
    const agentId = decodeURIComponent(automation[1] ?? '');
    const next = {
      ...data,
      agents: data.agents.map((agent) =>
        agent.agentId === agentId
          ? {
              ...agent,
              autoPublish: Boolean(body.autoPublish),
              autoAcceptPolicy: body.autoAcceptPolicy,
              autoAcceptTaskCategories: body.autoAcceptTaskCategories,
            }
          : agent,
      ),
      publications: body.autoPublish
        ? [
            ...data.publications.filter((item) => item.agentId !== agentId),
            { agentId, published: true, updatedAt: new Date().toISOString() },
          ]
        : data.publications.filter((item) => item.agentId !== agentId),
    };
    return { data: next, settings, result: { ok: true } };
  }

  const runtime = path.match(/^\/v0\.1\/agents\/([^/]+)\/runtime$/);
  if (runtime && method === 'PUT') {
    const agentId = decodeURIComponent(runtime[1] ?? '');
    const endpoint = String(body.endpoint ?? '');
    const record = {
      agentId,
      endpoint,
      a2aEndpoint: endpoint,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
    };
    return {
      data: {
        ...data,
        runtimes: [...data.runtimes.filter((item) => item.agentId !== agentId), record],
      },
      settings,
      result: record,
    };
  }
  const tokenCollection = path.match(/^\/v0\.1\/agents\/([^/]+)\/access-tokens$/);
  if (tokenCollection && method === 'POST') {
    const agentId = decodeURIComponent(tokenCollection[1] ?? '');
    const tokenId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const createdAt = new Date();
    const expiresInDays = Number(body.expiresInDays ?? 365);
    const record = {
      tokenId,
      agentId,
      name: String(body.name ?? 'Hosted provider'),
      scopes: ['mcp:access', 'runtime:connect'],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + expiresInDays * 86_400_000).toISOString(),
    };
    return {
      data: { ...data, accessTokens: [record, ...data.accessTokens] },
      settings,
      result: {
        ...record,
        token: `oc_at_${tokenId}.preview_agent_access_token_secret_not_for_production`,
      },
    };
  }
  const tokenItem = path.match(/^\/v0\.1\/agents\/([^/]+)\/access-tokens\/([^/]+)$/);
  if (tokenItem && method === 'DELETE') {
    const tokenId = decodeURIComponent(tokenItem[2] ?? '');
    return {
      data: {
        ...data,
        accessTokens: data.accessTokens.map((token) =>
          token.tokenId === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      },
      settings,
      result: { tokenId, revokedAt: new Date().toISOString() },
    };
  }
  const agentDelete = path.match(/^\/v0\.1\/agents\/([^/]+)$/);
  if (agentDelete && method === 'DELETE') {
    const agentId = decodeURIComponent(agentDelete[1] ?? '');
    return {
      data: {
        ...data,
        agents: data.agents.filter((item) => item.agentId !== agentId),
        publications: data.publications.filter((item) => item.agentId !== agentId),
        runtimes: data.runtimes.filter((item) => item.agentId !== agentId),
        installations: data.installations.filter((item) => item.agentId !== agentId),
        accessTokens: data.accessTokens.filter((item) => item.agentId !== agentId),
      },
      settings,
      result: { agentId, deleted: true },
    };
  }

  if (runtime && method === 'DELETE') {
    const agentId = decodeURIComponent(runtime[1] ?? '');
    return {
      data: {
        ...data,
        runtimes: data.runtimes.filter((item) => item.agentId !== agentId),
      },
      settings,
      result: { agentId, status: 'disabled' },
    };
  }

  const federated = path.match(/^\/v0\.1\/federated-interactions\/([^/]+)\/respond$/);
  if (federated && method === 'POST') {
    const interactionId = decodeURIComponent(federated[1] ?? '');
    const decision = body.decision === 'accept' ? 'active' : 'rejected';
    return {
      data: {
        ...data,
        federatedInteractions: data.federatedInteractions.map((item) =>
          item.interactionId === interactionId ? { ...item, status: decision } : item,
        ),
      },
      settings,
      result: { ok: true },
    };
  }

  const onboarding = path.match(/^\/v0\.1\/onboarding\/([^/]+)\/(approve|reject)$/);
  if (onboarding && method === 'POST') {
    const requestId = decodeURIComponent(onboarding[1] ?? '');
    const decision = onboarding[2] === 'approve' ? 'approved' : 'rejected';
    return {
      data: {
        ...data,
        setupRequests: data.setupRequests.map((item) =>
          item.requestId === requestId
            ? { ...item, status: decision, decidedAt: new Date().toISOString() }
            : item,
        ),
      },
      settings,
      result: { ok: true },
    };
  }

  throw new Error('Preview cannot perform this action');
}

export function isPreviewActive() {
  return import.meta.env.DEV && sessionStorage.getItem(previewKey) === '1';
}

export function enablePreview() {
  sessionStorage.setItem(previewKey, '1');
}

export function disablePreview() {
  sessionStorage.removeItem(previewKey);
}
