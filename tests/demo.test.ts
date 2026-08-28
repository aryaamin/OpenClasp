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
  });
});
