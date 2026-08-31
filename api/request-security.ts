import { FixedWindowRateLimiter } from '../apps/api/src/security.js';

const limiter = new FixedWindowRateLimiter();

function clientAddress(request: Request): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function guardRequest(
  request: Request,
  bucket: string,
  options: { limit: number; windowMs?: number; maximumBytes?: number },
): Promise<Response | undefined> {
  const result = limiter.consume(
    `${bucket}:${clientAddress(request)}`,
    options.limit,
    options.windowMs ?? 60_000,
  );
  if (!result.allowed)
    return Response.json(
      { error: 'rate_limit_exceeded' },
      {
        status: 429,
        headers: {
          'cache-control': 'no-store',
          'retry-after': String(result.retryAfterSeconds),
        },
      },
    );

  if (options.maximumBytes !== undefined) {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > options.maximumBytes)
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    const body = await request.clone().arrayBuffer();
    if (body.byteLength > options.maximumBytes)
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
  }
  return undefined;
}
