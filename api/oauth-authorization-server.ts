import { authServerMetadataHandlerClerk } from '@clerk/mcp-tools/next';

export async function GET(): Promise<Response> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return Response.json({ error: 'OAuth provider is not configured' }, { status: 503 });
  return authServerMetadataHandlerClerk()();
}
