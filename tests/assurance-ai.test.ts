import { describe, expect, it } from 'vitest';
import {
  generateAssuranceProbePlan,
  type AssuranceGenerationStore,
  type GenerateAssuranceProbeInput,
} from '../packages/mcp-server/src/assurance-ai.js';

function input(): GenerateAssuranceProbeInput {
  const interactionId = crypto.randomUUID();
  return {
    operatorId: 'operator:a',
    phase: 'pre_task',
    generatedForAgentId: 'agent:a',
    interaction: {
      interactionId,
      termsHash: 'contract-hash',
      contract: {
        purpose: 'Research a market',
        taskCategory: 'research',
        requestedOutcome: 'A sourced brief',
        successCriteria: ['Primary sources included'],
        evidenceRequirements: ['links'],
        allowedActions: ['browse'],
        prohibitedActions: ['purchase'],
        allowedData: ['public'],
        prohibitedData: ['secrets'],
        delegationRules: [],
        humanApprovalRequirements: [],
        completionConditions: [],
        cancellationConditions: [],
      },
    } as unknown as GenerateAssuranceProbeInput['interaction'],
    targetCard: {
      agentId: 'agent:b',
      agentVersion: '1.0.0',
      capabilities: ['research'],
      limitations: ['no purchases'],
      verification: { status: 'verified' },
    } as GenerateAssuranceProbeInput['targetCard'],
  };
}

function memoryStore() {
  let started: Parameters<AssuranceGenerationStore['beginAssuranceGeneration']>[0] | undefined;
  let finished: Parameters<AssuranceGenerationStore['finishAssuranceGeneration']>[2] | undefined;
  const store: AssuranceGenerationStore = {
    async beginAssuranceGeneration(record) {
      started = record;
    },
    async finishAssuranceGeneration(_operatorId, _generationId, value) {
      finished = value;
    },
    async saveAssuranceDecision(_operatorId, decision, plan) {
      return { decision, plan };
    },
  };
  return { store, started: () => started, finished: () => finished };
}

describe('adaptive assurance AI', () => {
  it('persists a bounded structured generation without conversation data', async () => {
    const memory = memoryStore();
    const result = await generateAssuranceProbePlan(input(), memory.store, async () => ({
      decision: {
        successProbability: 0.72,
        confidence: 0.6,
        risks: [
          {
            riskCode: 'source_access_risk',
            dimension: 'data_access',
            title: 'Primary source access is uncertain',
            rationale: 'The task requires primary sources.',
            likelihood: 0.4,
            impact: 0.7,
            confidence: 0.6,
          },
        ],
        candidateQuestions: [
          {
            questionCode: 'source_access',
            prompt: 'Can you access primary sources for this task?',
            responseType: 'boolean',
            evidenceRequested: false,
            required: true,
            questionFamily: 'data_access',
            riskHypothesis: 'The agent may not have access to the required primary sources.',
            expectedSignals: [
              { answer: 'true', effect: 'increase_success', probabilityDelta: 0.08 },
              { answer: 'false', effect: 'reduce_success', probabilityDelta: -0.2 },
            ],
            expectedInformationGain: 0.9,
            selectionReason: 'Source access is required for the agreed outcome.',
            recommendedSafeguardCodes: ['require_evidence'],
          },
        ],
        safeguards: [],
      },
      tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    }));

    expect(result.decision.generation.mode).toBe('ai');
    expect(result.plan.questions).toHaveLength(1);
    expect(memory.finished()).toMatchObject({
      status: 'complete',
      tokenUsage: { totalTokens: 120 },
    });
    expect(JSON.stringify(memory.started()?.input)).not.toMatch(/conversation|transcript/i);
  });

  it('falls back when model output violates the bounded question schema', async () => {
    const memory = memoryStore();
    const result = await generateAssuranceProbePlan(input(), memory.store, async () => {
      throw new Error('malformed model output');
    });

    expect(result.decision.generation.mode).toBe('fallback');
    expect(result.plan.questions).toHaveLength(1);
    expect(memory.finished()).toMatchObject({ status: 'fallback', errorCode: 'Error' });
  });

  it('asks one non-redundant question per sequential round', async () => {
    const base = input();
    const first = await generateAssuranceProbePlan(base, memoryStore().store, async () => {
      throw new Error('provider unavailable');
    });
    const second = await generateAssuranceProbePlan(
      {
        ...base,
        previousPlans: [first.plan],
        previousPredictions: [first.decision.prediction],
      },
      memoryStore().store,
      async () => {
        throw new Error('provider unavailable');
      },
    );

    expect(first.plan.questions).toHaveLength(1);
    expect(second.plan.questions).toHaveLength(1);
    expect(second.plan.round).toBe(2);
    expect(second.plan.questions[0]?.questionCode).not.toBe(first.plan.questions[0]?.questionCode);
    expect(second.decision.prediction.priorPredictionId).toBe(
      first.decision.prediction.predictionId,
    );
  });

  it('marks the generation failed when decision persistence fails', async () => {
    const memory = memoryStore();
    memory.store.saveAssuranceDecision = async () => {
      throw new Error('database unavailable');
    };

    await expect(
      generateAssuranceProbePlan(input(), memory.store, async () => {
        throw new Error('provider unavailable');
      }),
    ).rejects.toThrow('database unavailable');
    expect(memory.finished()).toMatchObject({
      status: 'error',
      errorCode: 'persistence_failed',
    });
  });
});
