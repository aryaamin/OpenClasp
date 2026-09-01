import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type ProviderConnectionStatus = 'pending' | 'connected' | 'expired';

export type ProviderConnection = {
  connectionId: string;
  operatorId: string;
  provider: 'botpress';
  agentName: string;
  codeHash: string;
  status: ProviderConnectionStatus;
  agentId?: string;
  runtimeEndpoint?: string;
  credentialPublicKey?: string;
  credentialCiphertext?: string;
  createdAt: string;
  expiresAt: string;
  connectedAt?: string;
};

export type PublicProviderConnection = Omit<
  ProviderConnection,
  'operatorId' | 'codeHash' | 'credentialPublicKey' | 'credentialCiphertext'
>;

export function createProviderConnectionInput(
  operatorId: string,
  provider: ProviderConnection['provider'],
  agentName: string,
  lifetimeMinutes = 15,
) {
  const name = agentName.trim();
  if (!name) throw new Error('Agent name is required');
  const code = `oc_bp_${randomBytes(24).toString('base64url')}`;
  const createdAt = new Date();
  const minutes = Math.max(5, Math.min(30, lifetimeMinutes));
  const connection: ProviderConnection = {
    connectionId: randomUUID(),
    operatorId,
    provider,
    agentName: name,
    codeHash: hashProviderConnectionCode(code),
    status: 'pending',
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + minutes * 60_000).toISOString(),
  };
  return { connection, code };
}

export function hashProviderConnectionCode(code: string) {
  return createHash('sha256').update(code).digest('base64url');
}

export function publicProviderConnection(connection: ProviderConnection): PublicProviderConnection {
  const safe = { ...connection } as Partial<ProviderConnection>;
  delete safe.operatorId;
  delete safe.codeHash;
  delete safe.credentialPublicKey;
  delete safe.credentialCiphertext;
  return safe as PublicProviderConnection;
}
