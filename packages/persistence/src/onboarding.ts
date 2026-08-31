import { randomUUID } from 'node:crypto';

export type Project = {
  projectId: string;
  name: string;
  createdAt: string;
};

export type AgentProfile = {
  agentId: string;
  projectId: string;
  name: string;
  description: string;
  framework: string;
  agentVersion: string;
  agentMode?: 'persistent_runtime' | 'temporary_chat';
  a2aEndpoint?: string;
  transport?: 'direct_a2a' | 'openclasp_gateway';
  autoPublish: boolean;
  autoAcceptPolicy: 'off' | 'safe_matching';
  autoAcceptTaskCategories: string[];
  capabilities: string[];
  limitations: string[];
  identityMode: 'oauth_installation' | 'owner_managed';
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
};

export type AgentInstallation = {
  installationId: string;
  clientId: string;
  agentId: string;
  projectId: string;
  connectedAt: string;
  updatedAt: string;
};

export type SetupRequest = {
  requestId: string;
  clientId: string;
  action: 'connect' | 'switch';
  status: 'pending' | 'approved' | 'rejected';
  agentName?: string;
  description?: string;
  projectName?: string;
  projectId?: string;
  existingAgentId?: string;
  framework: string;
  agentVersion: string;
  agentMode: 'persistent_runtime' | 'temporary_chat';
  a2aEndpoint?: string;
  autoPublish: boolean;
  autoAcceptPolicy: 'off' | 'safe_matching';
  autoAcceptTaskCategories: string[];
  capabilities: string[];
  limitations: string[];
  requestedAt: string;
  decidedAt?: string;
  installationId?: string;
};

export type OnboardingKind = 'project' | 'agent_profile' | 'installation' | 'setup_request';

export type OnboardingRow = {
  kind: string;
  recordId: string;
  payload: any;
};

export interface OnboardingStore {
  list(operatorId: string): Promise<OnboardingRow[]>;
  upsert(
    operatorId: string,
    kind: OnboardingKind,
    recordId: string,
    payload: unknown,
  ): Promise<void>;
}

export type OnboardingState = {
  projects: Project[];
  agentProfiles: AgentProfile[];
  installations: AgentInstallation[];
  setupRequests: SetupRequest[];
};

export async function getOnboardingState(
  store: OnboardingStore,
  operatorId: string,
): Promise<OnboardingState> {
  const rows = await store.list(operatorId);
  const values = <T>(kind: OnboardingKind) =>
    rows.filter((row) => row.kind === kind).map((row) => row.payload as T);
  return {
    projects: values<Project>('project'),
    agentProfiles: values<AgentProfile>('agent_profile').map((agent) => ({
      ...agent,
      agentMode: agent.agentMode ?? (agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat'),
      transport: agent.a2aEndpoint ? 'direct_a2a' : (agent.transport ?? 'direct_a2a'),
      description: agent.description ?? '',
      agentVersion: agent.agentVersion ?? '1.0.0',
      autoPublish: agent.autoPublish ?? false,
      autoAcceptPolicy: agent.autoAcceptPolicy ?? 'off',
      autoAcceptTaskCategories: agent.autoAcceptTaskCategories ?? [],
    })),
    installations: values<AgentInstallation>('installation'),
    setupRequests: values<SetupRequest>('setup_request'),
  };
}

export async function resolveInstallation(
  store: OnboardingStore,
  operatorId: string,
  clientId: string,
) {
  const state = await getOnboardingState(store, operatorId);
  const installation = state.installations.find((item) => item.clientId === clientId);
  if (!installation) return { status: 'unbound' as const };
  const agent = state.agentProfiles.find((item) => item.agentId === installation.agentId);
  const project = state.projects.find((item) => item.projectId === installation.projectId);
  if (!agent || !project) return { status: 'invalid_binding' as const, installation };
  return { status: 'connected' as const, installation, agent, project };
}

export async function createHostedProviderAgent(
  store: OnboardingStore,
  operatorId: string,
  input: {
    provider: 'botpress' | 'custom';
    agentName: string;
    projectName: string;
    description?: string | undefined;
    capabilities?: string[] | undefined;
    limitations?: string[] | undefined;
  },
) {
  const state = await getOnboardingState(store, operatorId);
  const projectName = input.projectName.trim();
  const agentName = input.agentName.trim();
  if (!projectName || !agentName) throw new Error('Agent and project names are required');
  const now = new Date().toISOString();
  let project = state.projects.find(
    (candidate) => candidate.name.trim().toLowerCase() === projectName.toLowerCase(),
  );
  if (!project) {
    project = { projectId: `project_${randomUUID()}`, name: projectName, createdAt: now };
    await store.upsert(operatorId, 'project', project.projectId, project);
  }
  const agent: AgentProfile = {
    agentId: `agent_${randomUUID()}`,
    projectId: project.projectId,
    name: agentName,
    description: input.description?.trim() ?? '',
    framework: input.provider === 'botpress' ? 'Botpress' : 'Custom runtime',
    agentVersion: '1.0.0',
    agentMode: 'persistent_runtime',
    transport: 'direct_a2a',
    autoPublish: false,
    autoAcceptPolicy: 'off',
    autoAcceptTaskCategories: [],
    capabilities: [...new Set(input.capabilities ?? [])],
    limitations: [...new Set(input.limitations ?? [])],
    identityMode: 'owner_managed',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await store.upsert(operatorId, 'agent_profile', agent.agentId, agent);
  return { project, agent };
}

export async function createDashboardAgent(
  store: OnboardingStore,
  operatorId: string,
  input: {
    agentName: string;
    projectName: string;
    description: string;
    framework?: string | undefined;
    capabilities: string[];
    limitations?: string[] | undefined;
  },
) {
  const state = await getOnboardingState(store, operatorId);
  const projectName = input.projectName.trim();
  const agentName = input.agentName.trim();
  if (!projectName || !agentName) throw new Error('Agent and project names are required');
  const capabilities = [
    ...new Set(input.capabilities.map((value) => value.trim()).filter(Boolean)),
  ];
  if (!capabilities.length) throw new Error('At least one capability is required');
  const now = new Date().toISOString();
  let project = state.projects.find(
    (candidate) => candidate.name.trim().toLowerCase() === projectName.toLowerCase(),
  );
  if (!project) {
    project = { projectId: `project_${randomUUID()}`, name: projectName, createdAt: now };
    await store.upsert(operatorId, 'project', project.projectId, project);
  }
  const existing = state.agentProfiles.find(
    (candidate) =>
      candidate.status === 'active' &&
      candidate.projectId === project!.projectId &&
      candidate.name.trim().toLowerCase() === agentName.toLowerCase(),
  );
  if (existing) return { project, agent: existing };
  const agent: AgentProfile = {
    agentId: `agent_${randomUUID()}`,
    projectId: project.projectId,
    name: agentName,
    description: input.description.trim(),
    framework: input.framework?.trim() || 'Custom agent',
    agentVersion: '1.0.0',
    agentMode: 'persistent_runtime',
    transport: 'direct_a2a',
    autoPublish: false,
    autoAcceptPolicy: 'off',
    autoAcceptTaskCategories: [],
    capabilities,
    limitations: [
      ...new Set((input.limitations ?? []).map((value) => value.trim()).filter(Boolean)),
    ],
    identityMode: 'owner_managed',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await store.upsert(operatorId, 'agent_profile', agent.agentId, agent);
  return { project, agent };
}

export async function requestAgentSetup(
  store: OnboardingStore,
  operatorId: string,
  input: {
    clientId: string;
    action?: 'connect' | 'switch' | undefined;
    agentName?: string | undefined;
    projectName?: string | undefined;
    projectId?: string | undefined;
    existingAgentId?: string | undefined;
    framework?: string | undefined;
    description?: string | undefined;
    agentVersion?: string | undefined;
    agentMode?: 'persistent_runtime' | 'temporary_chat' | undefined;
    a2aEndpoint?: string | undefined;
    autoPublish?: boolean | undefined;
    autoAcceptPolicy?: 'off' | 'safe_matching' | undefined;
    autoAcceptTaskCategories?: string[] | undefined;
    capabilities?: string[] | undefined;
    limitations?: string[] | undefined;
  },
): Promise<SetupRequest> {
  const state = await getOnboardingState(store, operatorId);
  const pending = state.setupRequests.find(
    (item) => item.clientId === input.clientId && item.status === 'pending',
  );
  if (pending) return pending;
  if (
    !input.existingAgentId &&
    (!input.agentName?.trim() || (!input.projectId && !input.projectName?.trim()))
  )
    throw new Error('agentName and either projectName or projectId are required for a new agent');
  if (
    input.existingAgentId &&
    !state.agentProfiles.some((agent) => agent.agentId === input.existingAgentId)
  )
    throw new Error('Existing agent not found');
  if (input.projectId && !state.projects.some((project) => project.projectId === input.projectId))
    throw new Error('Project not found');

  const request: SetupRequest = {
    requestId: randomUUID(),
    clientId: input.clientId,
    action: input.action ?? (input.existingAgentId ? 'switch' : 'connect'),
    status: 'pending',
    ...(input.agentName?.trim() ? { agentName: input.agentName.trim() } : {}),
    ...(input.projectName?.trim() ? { projectName: input.projectName.trim() } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.existingAgentId ? { existingAgentId: input.existingAgentId } : {}),
    framework: input.framework?.trim() || 'unknown',
    description: input.description?.trim() || '',
    agentVersion: input.agentVersion?.trim() || '1.0.0',
    agentMode: input.agentMode ?? 'temporary_chat',
    ...(input.a2aEndpoint?.trim() ? { a2aEndpoint: input.a2aEndpoint.trim() } : {}),
    autoPublish: input.autoPublish ?? true,
    autoAcceptPolicy: input.autoAcceptPolicy ?? 'safe_matching',
    autoAcceptTaskCategories: [
      ...new Set(input.autoAcceptTaskCategories ?? input.capabilities ?? []),
    ],
    capabilities: [...new Set(input.capabilities ?? [])],
    limitations: [...new Set(input.limitations ?? [])],
    requestedAt: new Date().toISOString(),
  };
  await store.upsert(operatorId, 'setup_request', request.requestId, request);
  return request;
}

export async function approveAgentSetup(
  store: OnboardingStore,
  operatorId: string,
  requestId: string,
) {
  const state = await getOnboardingState(store, operatorId);
  const request = state.setupRequests.find((item) => item.requestId === requestId);
  if (!request) throw new Error('Setup request not found');
  if (request.status === 'rejected') throw new Error('Setup request was rejected');
  if (request.status === 'approved')
    return resolveInstallation(store, operatorId, request.clientId);

  const now = new Date().toISOString();
  let agent = request.existingAgentId
    ? state.agentProfiles.find((item) => item.agentId === request.existingAgentId)
    : undefined;
  let project = agent
    ? state.projects.find((item) => item.projectId === agent!.projectId)
    : request.projectId
      ? state.projects.find((item) => item.projectId === request.projectId)
      : undefined;

  if (!project) {
    project = {
      projectId: `project_${randomUUID()}`,
      name: request.projectName!,
      createdAt: now,
    };
    await store.upsert(operatorId, 'project', project.projectId, project);
  }
  if (!agent) {
    agent = {
      agentId: `agent_${randomUUID()}`,
      projectId: project.projectId,
      name: request.agentName!,
      description: request.description ?? '',
      framework: request.framework,
      agentVersion: request.agentVersion,
      agentMode: request.agentMode ?? 'temporary_chat',
      transport: 'direct_a2a',
      autoPublish: request.autoPublish ?? false,
      autoAcceptPolicy: request.autoAcceptPolicy ?? 'off',
      autoAcceptTaskCategories: request.autoAcceptTaskCategories ?? [],
      capabilities: request.capabilities,
      limitations: request.limitations,
      identityMode: 'oauth_installation',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await store.upsert(operatorId, 'agent_profile', agent.agentId, agent);
  }

  const previous = state.installations.find((item) => item.clientId === request.clientId);
  const installation: AgentInstallation = {
    installationId: previous?.installationId ?? `install_${randomUUID()}`,
    clientId: request.clientId,
    agentId: agent.agentId,
    projectId: project.projectId,
    connectedAt: previous?.connectedAt ?? now,
    updatedAt: now,
  };
  await store.upsert(operatorId, 'installation', request.clientId, installation);
  await store.upsert(operatorId, 'setup_request', request.requestId, {
    ...request,
    status: 'approved',
    decidedAt: now,
    installationId: installation.installationId,
  } satisfies SetupRequest);
  return { status: 'connected' as const, installation, agent, project };
}

export async function rejectAgentSetup(
  store: OnboardingStore,
  operatorId: string,
  requestId: string,
) {
  const state = await getOnboardingState(store, operatorId);
  const request = state.setupRequests.find((item) => item.requestId === requestId);
  if (!request) throw new Error('Setup request not found');
  if (request.status !== 'pending') throw new Error('Setup request is no longer pending');
  const rejected: SetupRequest = {
    ...request,
    status: 'rejected',
    decidedAt: new Date().toISOString(),
  };
  await store.upsert(operatorId, 'setup_request', requestId, rejected);
  return rejected;
}

export async function updateAgentProfile(
  store: OnboardingStore,
  operatorId: string,
  clientId: string,
  patch: {
    name?: string | undefined;
    description?: string | undefined;
    framework?: string | undefined;
    agentVersion?: string | undefined;
    agentMode?: 'persistent_runtime' | 'temporary_chat' | undefined;
    a2aEndpoint?: string | undefined;
    autoPublish?: boolean | undefined;
    autoAcceptPolicy?: 'off' | 'safe_matching' | undefined;
    autoAcceptTaskCategories?: string[] | undefined;
    capabilities?: string[] | undefined;
    limitations?: string[] | undefined;
  },
) {
  const binding = await resolveInstallation(store, operatorId, clientId);
  if (binding.status !== 'connected') throw new Error('This MCP installation is not connected');
  const agent: AgentProfile = {
    ...binding.agent,
    transport: 'direct_a2a',
    agentMode:
      patch.agentMode ??
      binding.agent.agentMode ??
      (binding.agent.a2aEndpoint ? 'persistent_runtime' : 'temporary_chat'),
    ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    ...(patch.framework?.trim() ? { framework: patch.framework.trim() } : {}),
    ...(patch.agentVersion?.trim() ? { agentVersion: patch.agentVersion.trim() } : {}),
    ...(patch.autoPublish !== undefined ? { autoPublish: patch.autoPublish } : {}),
    ...(patch.autoAcceptPolicy ? { autoAcceptPolicy: patch.autoAcceptPolicy } : {}),
    ...(patch.autoAcceptTaskCategories
      ? { autoAcceptTaskCategories: [...new Set(patch.autoAcceptTaskCategories)] }
      : {}),
    ...(patch.capabilities ? { capabilities: [...new Set(patch.capabilities)] } : {}),
    ...(patch.limitations ? { limitations: [...new Set(patch.limitations)] } : {}),
    updatedAt: new Date().toISOString(),
  };
  await store.upsert(operatorId, 'agent_profile', agent.agentId, agent);
  return agent;
}
