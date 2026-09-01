import { describe, expect, it } from 'vitest';
import {
  createProviderConnectionInput,
  hashProviderConnectionCode,
  publicProviderConnection,
} from '../packages/persistence/src/provider-connection.js';

describe('provider connections', () => {
  it('creates an expiring Botpress pairing code without exposing its hash', () => {
    const { connection, code } = createProviderConnectionInput(
      'owner-a',
      'botpress',
      'Purchasing agent',
    );
    expect(code).toMatch(/^oc_bp_/);
    expect(connection.codeHash).toBe(hashProviderConnectionCode(code));
    expect(connection.status).toBe('pending');
    expect(Date.parse(connection.expiresAt)).toBeGreaterThan(Date.now());
    expect(publicProviderConnection(connection)).not.toHaveProperty('operatorId');
    expect(publicProviderConnection(connection)).not.toHaveProperty('codeHash');
  });
});
