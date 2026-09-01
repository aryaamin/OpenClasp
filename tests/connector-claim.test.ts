import { generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createConnectorAgent,
  createConnectorClaimInput,
  encryptConnectorCredential,
  hashConnectorClaimSecret,
  publicConnectorClaim,
} from '../packages/persistence/src/connector-claim.js';

const profile = {
  description: 'Compares approved supplier quotes',
  framework: 'LangGraph',
  agentVersion: '2.1.0',
  modelProvider: 'Anthropic',
  modelName: 'Claude',
  capabilities: ['compare supplier quotes'],
  limitations: ['requires approval before payment'],
};

describe('runtime connector claims', () => {
  it('keeps the claim secret out of public state and encrypts credentials to the connector', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const { claim, claimSecret } = createConnectorClaimInput({
      runtimeEndpoint: 'https://agent.example/openclasp',
      credentialPublicKey: publicKey,
      profile,
    });
    expect(claim.secretHash).toBe(hashConnectorClaimSecret(claimSecret));
    expect(publicConnectorClaim(claim)).not.toHaveProperty('secretHash');
    expect(publicConnectorClaim(claim)).not.toHaveProperty('credentialPublicKey');

    const encrypted = encryptConnectorCredential(publicKey, 'oc_at_one-time-token');
    expect(
      privateDecrypt(
        { key: privateKey, oaepHash: 'sha256' },
        Buffer.from(encrypted, 'base64url'),
      ).toString('utf8'),
    ).toBe('oc_at_one-time-token');
  });

  it('creates an agent-owned profile with self-declared provenance', async () => {
    const rows: Array<{ kind: string; recordId: string; payload: any; metadata?: any }> = [];
    const store = {
      list: async () => rows,
      upsert: async (
        _operatorId: string,
        kind: string,
        recordId: string,
        payload: any,
        metadata?: any,
      ) => void rows.push({ kind, recordId, payload, metadata }),
    } as any;
    const result = await createConnectorAgent(store, 'owner-a', 'Purchasing agent', profile);
    expect(result.project.name).toBe('Connected agents');
    expect(result.agent).toMatchObject({
      identityMode: 'connector_claim',
      name: 'Purchasing agent',
      nameProvenance: 'operator_attested',
      profileProvenance: 'self_declared',
      modelProvider: 'Anthropic',
      modelName: 'Claude',
      autoPublish: false,
    });
    expect(rows.find((row) => row.kind === 'agent_profile')?.metadata).toMatchObject({
      provenance: 'operator_attested',
    });
  });
});
