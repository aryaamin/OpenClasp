export type StructuredCheckpoint = {
  state: 'active' | 'blocked' | 'ready_to_finalize' | 'done' | 'cancelled';
  progress: number;
  criteriaMet: string[];
  criteriaRemaining: string[];
  blockerCodes: string[];
  topicStatus: 'in_scope' | 'drifting' | 'changed';
  expectedRemainingTurns?: number;
  needsHuman: boolean;
  confidence: number;
};

const strings = (value: unknown, limit: number, maxLength: number) =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, limit)
    .map((item) => item.trim().slice(0, maxLength));

const checkpointJson = (value: string) => {
  const marker = value.indexOf('OPENCLASP_CHECKPOINT');
  const source = marker >= 0 ? value.slice(marker + 'OPENCLASP_CHECKPOINT'.length) : value;
  const start = source.indexOf('{');
  if (start < 0) throw new Error('Checkpoint JSON object is missing');
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
  throw new Error('Checkpoint JSON object is incomplete');
};

export function parseCheckpoint(text: string): StructuredCheckpoint {
  const value = checkpointJson(text) as Record<string, unknown>;
  const states = ['active', 'blocked', 'ready_to_finalize', 'done', 'cancelled'] as const;
  const topics = ['in_scope', 'drifting', 'changed'] as const;
  if (!states.includes(value.state as (typeof states)[number]))
    throw new Error('Checkpoint state is invalid');
  if (!topics.includes(value.topicStatus as (typeof topics)[number]))
    throw new Error('Checkpoint topic status is invalid');
  if (typeof value.progress !== 'number' || value.progress < 0 || value.progress > 1)
    throw new Error('Checkpoint progress is invalid');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)
    throw new Error('Checkpoint confidence is invalid');
  if (typeof value.needsHuman !== 'boolean') throw new Error('Checkpoint needsHuman is invalid');
  if (
    value.expectedRemainingTurns !== undefined &&
    (typeof value.expectedRemainingTurns !== 'number' ||
      !Number.isInteger(value.expectedRemainingTurns) ||
      value.expectedRemainingTurns < 0 ||
      value.expectedRemainingTurns > 1000)
  )
    throw new Error('Checkpoint expectedRemainingTurns is invalid');
  return {
    state: value.state as StructuredCheckpoint['state'],
    progress: value.progress,
    criteriaMet: strings(value.criteriaMet, 100, 1000),
    criteriaRemaining: strings(value.criteriaRemaining, 100, 1000),
    blockerCodes: strings(value.blockerCodes, 32, 64).filter((item) =>
      /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(item),
    ),
    topicStatus: value.topicStatus as StructuredCheckpoint['topicStatus'],
    ...(value.expectedRemainingTurns !== undefined
      ? { expectedRemainingTurns: value.expectedRemainingTurns as number }
      : {}),
    needsHuman: value.needsHuman,
    confidence: value.confidence,
  };
}
