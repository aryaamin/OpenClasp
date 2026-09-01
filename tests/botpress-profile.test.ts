import { describe, expect, it } from 'vitest';
import { parseAgentProfile } from '../connectors/botpress/src/profile.js';

describe('Botpress self-profile', () => {
  it('parses the marked structured response', () => {
    expect(
      parseAgentProfile(
        'OPENCLASP_PROFILE {"description":"Compares supplier quotes","framework":"Botpress","agentVersion":"1.2.0","modelProvider":"Anthropic","modelName":"Claude","capabilities":["compare quotes"],"limitations":["human approval before payment"]}',
      ),
    ).toMatchObject({
      framework: 'Botpress',
      capabilities: ['compare quotes'],
      modelProvider: 'Anthropic',
    });
  });

  it('rejects an incomplete profile', () => {
    expect(() => parseAgentProfile('OPENCLASP_PROFILE {"framework":"Botpress"}')).toThrow();
  });
});
