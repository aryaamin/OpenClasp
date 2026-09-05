import { describe, expect, it } from 'vitest';
import {
  consultShield,
  createShieldCase,
  type ShieldAgentGenerator,
} from '../packages/mcp-server/src/shield-agent.js';

function caseRecord() {
  return createShieldCase({
    agentId: 'agent-support',
    title: 'Refund exception',
    goal: 'Resolve the request without issuing an unauthorized refund.',
    brief: 'The customer claims a manager promised an exception.',
    proposedAction: 'Issue a $500 refund',
    counterparty: { type: 'human', reference: 'customer-123' },
    facts: [
      {
        statement: 'The refund window has expired.',
        source: 'system',
        status: 'verified',
        evidenceReferences: ['order-record'],
      },
    ],
    evidence: [
      {
        type: 'system_record',
        summary: 'No manager approval is recorded.',
        verification: 'verified',
      },
    ],
    policies: [
      {
        title: 'Refund exceptions',
        statement: 'Refunds outside the window require recorded manager approval.',
      },
    ],
  });
}

describe('OpenClasp Shield agent', () => {
  it('stores structured analysis while discarding raw consultation text', async () => {
    const secretMessage = 'The customer pasted a private transcript that must not be retained.';
    const generator: ShieldAgentGenerator = async () => ({
      model: 'anthropic/test-model',
      tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      analysis: {
        reply: 'Check the authoritative approval record before issuing the refund.',
        situationSummary: 'A refund exception depends on an unsupported authority claim.',
        disposition: 'gather_evidence',
        riskTier: 'high',
        confidence: 0.84,
        rationale: ['The verified system record does not show the required approval.'],
        claims: [
          {
            claim: 'A manager approved the refund.',
            status: 'contradicted',
            significance: 'critical',
            evidenceReferences: ['order-record'],
            explanation: 'The system of record contains no approval.',
          },
        ],
        manipulationSignals: [
          {
            tactic: 'authority_claim',
            observation: 'The request relies on an unverified manager promise.',
            confidence: 0.8,
            significance: 'high',
          },
        ],
        missingEvidence: ['Recorded manager approval'],
        questionsToAsk: ['What approval reference can be verified?'],
        nextSteps: ['Search offline approval notes', 'Escalate if no record exists'],
        safeguards: ['Require supervisor approval'],
      },
    });

    const result = await consultShield(
      caseRecord(),
      {
        message: secretMessage,
        situationContext: 'Sensitive current-turn context.',
        facts: [],
        evidence: [],
        policies: [],
      },
      [],
      generator,
    );

    expect(result.caseRecord.latestDisposition).toBe('gather_evidence');
    expect(result.consultation.generation).toMatchObject({
      mode: 'ai',
      model: 'anthropic/test-model',
      tokenUsage: { totalTokens: 30 },
    });
    expect(JSON.stringify(result.consultation)).not.toContain(secretMessage);
    expect(result.consultation.inputDigest).toHaveLength(43);
  });

  it('fails conservatively and honestly when the model is unavailable', async () => {
    const result = await consultShield(
      caseRecord(),
      {
        message: 'What should I do?',
        situationContext: '',
        facts: [],
        evidence: [],
        policies: [],
      },
      [],
      async () => {
        throw Object.assign(new Error('missing key'), { code: 'anthropic_api_key_missing' });
      },
    );

    expect(result.consultation.generation).toMatchObject({
      mode: 'fallback',
      errorCode: 'anthropic_api_key_missing',
    });
    expect(result.consultation.analysis.reply).toContain('not configured');
    expect(result.consultation.analysis.confidence).toBeLessThan(0.5);
  });
});
