import { describe, expect, it } from 'vitest';
import { parseCheckpoint } from '../connectors/botpress/src/checkpoint.js';

describe('Botpress progress checkpoints', () => {
  it('parses a compact structured checkpoint', () => {
    const checkpoint = parseCheckpoint(
      `OPENCLASP_CHECKPOINT ${JSON.stringify({
        state: 'active',
        progress: 0.6,
        criteriaMet: ['Price quoted'],
        criteriaRemaining: ['Confirm delivery'],
        blockerCodes: [],
        topicStatus: 'in_scope',
        expectedRemainingTurns: 2,
        needsHuman: false,
        confidence: 0.8,
        rawConversation: 'must be discarded',
      })}`,
    );

    expect(checkpoint.progress).toBe(0.6);
    expect(checkpoint.expectedRemainingTurns).toBe(2);
    expect(checkpoint).not.toHaveProperty('rawConversation');
  });

  it('rejects invalid progress and topic drift values', () => {
    expect(() =>
      parseCheckpoint(
        `OPENCLASP_CHECKPOINT ${JSON.stringify({
          state: 'active',
          progress: 2,
          criteriaMet: [],
          criteriaRemaining: [],
          blockerCodes: [],
          topicStatus: 'unknown',
          needsHuman: false,
          confidence: 0.5,
        })}`,
      ),
    ).toThrow();
  });
});
