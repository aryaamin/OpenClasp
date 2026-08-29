import { describe, expect, it } from 'vitest';
import { runDemo } from '../apps/demo/src/scenario.js';

describe('complete demonstration', () => {
  it('runs the signed interaction and adversarial checks', async () => {
    const output = await runDemo();
    expect(output.learnedRisk.sampleSize).toBe(1);
    expect(output.newVersionRisk.confidence).toBeLessThan(output.learnedRisk.confidence);
    expect(output.forwarding.networkPayloads).toHaveLength(1);
    expect(output.check.status).toBe('contradicted');
    expect(output.receipt.unilateral).toBe(false);
    expect(output.initialBrief).toMatchObject({
      recipientAgentId: 'agent:requester',
      subjectAgentId: 'agent:provider',
      decision: 'CHALLENGE',
    });
    expect(output.structuredConclusion.consensus).toBe('bilateral_agreement');
    expect(output.localEligibility).toMatchObject({
      eligible: true,
      contributionMode: 'local_only',
      structuredDataOnly: true,
    });
    expect(output.networkEligibility.contributionMode).toBe('network_aggregate');
    expect(output.weightedProfile.profile.sampleSize).toBe(1);
    expect(JSON.stringify(output.structuredConclusion)).not.toContain('private-note');
  });
});
