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
  framework: string;
  capabilities: string[];
  limitations: string[];
  identityMode: 'oauth_installation';
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
  projectName?: string;
  projectId?: string;
  existingAgentId?: string;
  framework: string;
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
    agentProfiles: values<AgentProfile>('agent_profile'),
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
      framework: request.framework,
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
    framework?: string | undefined;
    capabilities?: string[] | undefined;
    limitations?: string[] | undefined;
  },
) {
  const binding = await resolveInstallation(store, operatorId, clientId);
  if (binding.status !== 'connected') throw new Error('This MCP installation is not connected');
  const agent: AgentProfile = {
    ...binding.agent,
    ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.framework?.trim() ? { framework: patch.framework.trim() } : {}),
    ...(patch.capabilities ? { capabilities: [...new Set(patch.capabilities)] } : {}),
    ...(patch.limitations ? { limitations: [...new Set(patch.limitations)] } : {}),
    updatedAt: new Date().toISOString(),
  };
  await store.upsert(operatorId, 'agent_profile', agent.agentId, agent);
  return agent;
}
