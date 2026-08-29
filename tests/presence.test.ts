import { describe, expect, it } from 'vitest';
import {
  AGENT_ONLINE_WINDOW_MS,
  resolveAgentPresence,
} from '../packages/persistence/src/hosted.js';

describe('agent presence', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');

  it('uses a two-minute recent-activity window', () => {
    expect(
      resolveAgentPresence(new Date(now.getTime() - AGENT_ONLINE_WINDOW_MS + 1).toISOString(), now)
        .status,
    ).toBe('online');
    expect(
      resolveAgentPresence(new Date(now.getTime() - AGENT_ONLINE_WINDOW_MS - 1).toISOString(), now)
        .status,
    ).toBe('offline');
    expect(resolveAgentPresence(undefined, now)).toMatchObject({ status: 'offline' });
  });
});
