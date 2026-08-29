import { describe, expect, it } from 'vitest';
import cronFeedback from '../api/cron-feedback.js';

describe('feedback expiry cron', () => {
  it('requires the Vercel cron bearer secret', async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-cron-secret';
    let body = '';
    const response = {
      statusCode: 0,
      setHeader: () => undefined,
      end: (value?: string) => {
        body = value ?? '';
      },
    };
    await cronFeedback(
      { headers: { authorization: 'Bearer wrong-secret' } } as never,
      response as never,
    );
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(body)).toEqual({ error: 'unauthorized' });
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
});
