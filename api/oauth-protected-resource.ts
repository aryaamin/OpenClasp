import { protectedResourceHandlerClerk } from '@clerk/mcp-tools/next';

export function GET(request: Request): Response {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return Response.json({ error: 'OAuth provider is not configured' }, { status: 503 });
  return protectedResourceHandlerClerk()(request);
}
