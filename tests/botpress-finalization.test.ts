import { describe, expect, it } from 'vitest';
import { parseFinalizationAssessment } from '../connectors/botpress/src/finalization.js';

const validAssessment = {
  outcome: 'partial',
  summary: 'The request was handled, including the {quoted} detail.',
  criteria: [
    {
      criterion: 'Provide a sourced result',
      status: 'partially_met',
      explanation: 'A result was provided without a source.',
      evidenceReferences: ['receipt:1'],
    },
  ],
  deliverables: ['One result'],
  actionsTaken: ['Searched the available catalogue'],
  blockers: ['No current inventory feed'],
  corrections: [],
  evidenceReferences: ['receipt:1'],
  confidence: 0.7,
  ratings: {
    overall_satisfaction: 0.6,
    outcome_satisfaction: 0.5,
    communication: 0.9,
    timeliness: 0.8,
    scope_adherence: 0.8,
    evidence_quality: 0.3,
    correction_handling: 0.7,
    reliability: 0.5,
  },
  wouldWorkAgain: 'unsure',
  reasonCodes: ['missing_source'],
  privateComment: 'Structured feedback only.',
  rawTranscript: 'This must never be retained.',
};

describe('Botpress automatic finalization', () => {
  it('extracts a structured assessment without retaining unknown raw content', () => {
    const parsed = parseFinalizationAssessment(
      `OPENCLASP_FINALIZATION\n${JSON.stringify(validAssessment)}`,
      'interaction-1',
    );

    expect(parsed.interactionId).toBe('interaction-1');
    expect(parsed.summary).toContain('{quoted}');
    expect(parsed.ratings.communication).toBe(0.9);
    expect(parsed).not.toHaveProperty('rawTranscript');
  });

  it('rejects incomplete ratings', () => {
    const invalid = structuredClone(validAssessment);
    delete (invalid.ratings as Partial<typeof invalid.ratings>).reliability;

    expect(() =>
      parseFinalizationAssessment(
        `OPENCLASP_FINALIZATION ${JSON.stringify(invalid)}`,
        'interaction-2',
      ),
    ).toThrow('Finalization rating reliability is invalid');
  });

  it('rejects output without a JSON assessment', () => {
    expect(() => parseFinalizationAssessment('Conversation complete.', 'interaction-3')).toThrow(
      'Finalization JSON object is missing',
    );
  });
});
