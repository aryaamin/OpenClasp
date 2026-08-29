# Auth0 login and MCP OAuth setup

OpenClasp uses Auth0 for both human dashboard sessions and agent MCP OAuth. Vercel provisions the
tenant and application; OpenClasp does not store social-provider secrets.

## Vercel

1. Open the OpenClasp Vercel project and install the Auth0 Marketplace integration.
2. Connect it to Production, Preview, and Development.
3. Confirm Vercel created the Auth0 domain, client ID, and secret variables.
4. Redeploy after changing integration settings.

## Google and GitHub only

1. Open the linked tenant in Auth0 Dashboard.
2. Under **Authentication → Social**, configure Google and GitHub.
3. Promote both connections to domain level so DCR-created clients can use them.
4. Disable the database connection for the OpenClasp dashboard application.
5. Configure `/sso-callback`, `/login`, and the production origin in the SPA application settings.

The app starts each provider directly and returns through `/sso-callback` to `/dashboard`.

## MCP OAuth

1. Create an Auth0 API with identifier `https://openclasp.vercel.app/mcp`.
2. Keep standard OIDC scopes enabled. OpenClasp validates issuer, audience, subject, and OAuth client;
   it does not require every user to be manually assigned an Auth0 API role.
3. Enable Dynamic Client Registration and the Resource Parameter Compatibility Profile.
4. Keep `https://openclasp.vercel.app/mcp` as `OPENCLASP_MCP_URL` in Vercel.
5. Connect an MCP client to `https://openclasp.vercel.app/mcp`. It discovers Auth0, opens consent,
   and sends an OAuth access token. Dashboard session tokens are rejected at this endpoint.

## Hosted providers without OAuth

Botpress and similar hosted MCP clients may offer only None, Basic, or static Bearer
authentication. Use neither None nor Basic:

1. Open **Connect → Hosted provider → Botpress** in the OpenClasp dashboard.
2. Enter the new agent's name, project, purpose, capabilities, and limitations.
3. Create the connection and copy its token immediately. OpenClasp never shows it again and does not
   reuse an existing Codex or Cursor identity.
4. Set the provider's MCP URL to `https://openclasp.vercel.app/mcp`.
5. Select Bearer token authentication and paste the `oc_at_...` value.
6. Call `openclasp_get_identity` to confirm the provider is bound to the intended agent.

The token cannot authenticate to the dashboard API or another agent. Its hash is stored, its use is
audited, it expires after the selected lifetime, and revocation disconnects the provider
immediately. Do not paste a dashboard cookie or an Auth0 OAuth token into a hosted provider.

Before public beta, define narrower action-level OpenClasp permissions and automate their assignment
during onboarding instead of requiring manual Auth0 role setup.

## Smoke test

Test Google and GitHub separately in private browser windows. Each must end on `/dashboard`. Then
connect an MCP client and verify that an unauthenticated request receives a `401` with protected
resource metadata, while an approved OAuth token can list tools.
