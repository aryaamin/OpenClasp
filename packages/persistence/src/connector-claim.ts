import {
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  ConnectorAgentProfileSchema,
  type ConnectorAgentProfile,
} from '../../protocol/src/index.js';
import {
  getOnboardingState,
  type AgentProfile,
  type OnboardingStore,
  type Project,
} from './onboarding.js';

export type ConnectorClaimStatus = 'pending' | 'approved' | 'rejected' | 'connected' | 'expired';

export type ConnectorClaim = {
  claimId: string;
  secretHash: string;
  runtimeEndpoint: string;
  credentialPublicKey: string;
  profile: ConnectorAgentProfile;
  status: ConnectorClaimStatus;
  operatorId?: string;
  agentId?: string;
  credentialCiphertext?: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  connectedAt?: string;
};

export type PublicConnectorClaim = Omit<
  ConnectorClaim,
  'secretHash' | 'credentialPublicKey' | 'credentialCiphertext' | 'operatorId'
>;

export function createConnectorClaimInput(input: {
  runtimeEndpoint: string;
  credentialPublicKey: string;
  profile: ConnectorAgentProfile;
  lifetimeMinutes?: number;
}) {
  const key = createPublicKey(input.credentialPublicKey);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Connector key must be RSA');
  const details = key.asymmetricKeyDetails;
  if (details?.modulusLength && details.modulusLength < 2048)
    throw new Error('Connector RSA key must be at least 2048 bits');
  const claimSecret = `oc_cc_${randomBytes(32).toString('base64url')}`;
  const createdAt = new Date();
  const lifetimeMinutes = Math.max(5, Math.min(30, input.lifetimeMinutes ?? 15));
  const claim: ConnectorClaim = {
    claimId: randomUUID(),
    secretHash: hashConnectorClaimSecret(claimSecret),
    runtimeEndpoint: new URL(input.runtimeEndpoint).toString(),
    credentialPublicKey: input.credentialPublicKey,
    profile: ConnectorAgentProfileSchema.parse(input.profile),
    status: 'pending',
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + lifetimeMinutes * 60_000).toISOString(),
  };
  return { claim, claimSecret };
}

export function hashConnectorClaimSecret(secret: string) {
  return createHash('sha256').update(secret).digest('base64url');
}

export function matchesConnectorClaimSecret(expectedHash: string, secret: string) {
  const expected = Buffer.from(expectedHash);
  const actual = Buffer.from(hashConnectorClaimSecret(secret));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function connectorClaimExpired(claim: Pick<ConnectorClaim, 'expiresAt'>) {
  return Date.parse(claim.expiresAt) <= Date.now();
}

export function publicConnectorClaim(claim: ConnectorClaim): PublicConnectorClaim {
  const safe = { ...claim } as Partial<ConnectorClaim>;
  delete safe.secretHash;
  delete safe.credentialPublicKey;
  delete safe.credentialCiphertext;
  delete safe.operatorId;
  return safe as PublicConnectorClaim;
}

export function encryptConnectorCredential(publicKey: string, token: string) {
  return publicEncrypt(
    { key: createPublicKey(publicKey), oaepHash: 'sha256' },
    Buffer.from(token),
  ).toString('base64url');
}

export async function createConnectorAgent(
  store: OnboardingStore,
  operatorId: string,
  name: string,
  profile: ConnectorAgentProfile,
) {
  const agentName = name.trim();
  if (!agentName) throw new Error('Agent name is required');
  const now = new Date().toISOString();
  const state = await getOnboardingState(store, operatorId);
  let project = state.projects.find((item) => item.name === 'Connected agents');
  if (!project) {
    project = {
      projectId: `project_${randomUUID()}`,
      name: 'Connected agents',
      createdAt: now,
    } satisfies Project;
    await store.upsert(operatorId, 'project', project.projectId, project);
  }
  const agent: AgentProfile = {
    agentId: `agent_${randomUUID()}`,
    projectId: project.projectId,
    name: agentName,
    description: profile.description,
    framework: profile.framework,
    agentVersion: profile.agentVersion,
    ...(profile.modelProvider ? { modelProvider: profile.modelProvider } : {}),
    ...(profile.modelName ? { modelName: profile.modelName } : {}),
    nameProvenance: 'operator_attested',
    profileProvenance: 'self_declared',
    agentMode: 'persistent_runtime',
    transport: 'direct_a2a',
    autoPublish: false,
    autoAcceptPolicy: 'off',
    autoAcceptTaskCategories: [],
    capabilities: [...new Set(profile.capabilities)],
    limitations: [...new Set(profile.limitations)],
    identityMode: 'connector_claim',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await store.upsert(operatorId, 'agent_profile', agent.agentId, agent, {
    provenance: 'operator_attested',
    schemaName: 'openclasp.agent_profile',
    schemaVersion: '0.1',
  });
  return { project, agent };
}
