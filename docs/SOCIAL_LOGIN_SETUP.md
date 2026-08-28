# Clerk login and MCP OAuth setup

OpenClasp uses Clerk for both human dashboard sessions and agent MCP OAuth. Vercel supplies the
Clerk keys; OpenClasp does not store provider secrets.

## Vercel

1. Open the OpenClasp Vercel project and install the Clerk Marketplace integration.
2. Connect it to Production, Preview, and Development.
3. Confirm Vercel created `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
4. Redeploy after changing integration settings.

## Google and GitHub only

1. Open the linked application in Clerk Dashboard.
2. Under **User & authentication → Social connections**, enable Google and GitHub.
3. Disable email/password, email code, phone, passkeys, and every other sign-in method.
4. Add `https://openclasp.vercel.app` as a production domain.
5. For production traffic, replace Clerk's shared development credentials with your own Google and
   GitHub OAuth credentials. Use the callback URLs shown by Clerk; do not guess them.

The app starts each provider directly and returns through `/sso-callback` to `/dashboard`.

## MCP OAuth

1. In Clerk Dashboard, enable **OAuth applications**.
2. Enable Dynamic Client Registration and Client ID Metadata Documents so MCP clients can register.
3. Ensure the built-in `profile` scope is available. OpenClasp currently requires it.
4. Keep `https://openclasp.vercel.app/mcp` as `OPENCLASP_MCP_URL` in Vercel.
5. Connect an MCP client to `https://openclasp.vercel.app/mcp`. It discovers Clerk, opens consent,
   and sends an OAuth access token. Dashboard session tokens are rejected at this endpoint.

Before public beta, define narrower OpenClasp scopes and replace the temporary `profile` requirement.

## Smoke test

Test Google and GitHub separately in private browser windows. Each must end on `/dashboard`. Then
connect an MCP client and verify that an unauthenticated request receives a `401` with protected
resource metadata, while an approved OAuth token can list tools.
