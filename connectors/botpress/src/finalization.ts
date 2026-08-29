export type StructuredFinalization = Record<string, any>;

const boundedStrings = (value: unknown, limit: number, maxLength: number) =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, limit)
    .map((item) => item.trim().slice(0, maxLength));

export function extractFinalizationJson(value: string): unknown {
  const marker = value.indexOf('OPENCLASP_FINALIZATION');
  const source = marker >= 0 ? value.slice(marker + 'OPENCLASP_FINALIZATION'.length) : value;
  const start = source.indexOf('{');
  if (start < 0) throw new Error('Finalization JSON object is missing');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return JSON.parse(source.slice(start, index + 1));
  }
  throw new Error('Finalization JSON object is incomplete');
}

export function parseFinalizationAssessment(
  text: string,
  interactionId: string,
): StructuredFinalization {
  const value = extractFinalizationJson(text) as StructuredFinalization;
  const outcomes = ['success', 'partial', 'failure', 'cancelled'];
  const workAgain = ['yes', 'no', 'unsure'];
  const statuses = ['met', 'partially_met', 'missed', 'unknown'];
  const dimensions = [
    'overall_satisfaction',
    'outcome_satisfaction',
    'communication',
    'timeliness',
    'scope_adherence',
    'evidence_quality',
    'correction_handling',
    'reliability',
  ];
  if (!outcomes.includes(value.outcome) || typeof value.summary !== 'string')
    throw new Error('Finalization outcome or summary is invalid');
  if (!workAgain.includes(value.wouldWorkAgain))
    throw new Error('Finalization wouldWorkAgain is invalid');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)
    throw new Error('Finalization confidence is invalid');
  if (!value.ratings || typeof value.ratings !== 'object')
    throw new Error('Finalization ratings are missing');
  const ratings = Object.fromEntries(
    dimensions.map((dimension) => {
      const rating = value.ratings[dimension];
      if (typeof rating !== 'number' || rating < 0 || rating > 1)
        throw new Error(`Finalization rating ${dimension} is invalid`);
      return [dimension, rating];
    }),
  );
  const criteria = (Array.isArray(value.criteria) ? value.criteria : [])
    .slice(0, 100)
    .map((item) => {
      if (!item || typeof item !== 'object' || typeof item.criterion !== 'string')
        throw new Error('Finalization criterion is invalid');
      return {
        criterion: item.criterion.slice(0, 1000),
        status: statuses.includes(item.status) ? item.status : 'unknown',
        ...(typeof item.explanation === 'string'
          ? { explanation: item.explanation.slice(0, 1000) }
          : {}),
        evidenceReferences: boundedStrings(item.evidenceReferences, 50, 2048),
      };
    });
  return {
    interactionId,
    outcome: value.outcome,
    summary: value.summary.slice(0, 2000),
    criteria,
    deliverables: boundedStrings(value.deliverables, 100, 1000),
    actionsTaken: boundedStrings(value.actionsTaken, 100, 1000),
    blockers: boundedStrings(value.blockers, 100, 1000),
    corrections: boundedStrings(value.corrections, 100, 1000),
    evidenceReferences: boundedStrings(value.evidenceReferences, 100, 2048),
    confidence: value.confidence,
    ratings,
    wouldWorkAgain: value.wouldWorkAgain,
    reasonCodes: boundedStrings(value.reasonCodes, 32, 128),
    ...(typeof value.privateComment === 'string'
      ? { privateComment: value.privateComment.slice(0, 1000) }
      : {}),
  };
}
