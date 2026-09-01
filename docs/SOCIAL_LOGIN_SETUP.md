# Auth0 login and MCP OAuth setup

OpenClasp uses Auth0 for Google/GitHub identity. OpenClasp itself is the MCP OAuth authorization
server and stores public client registrations plus hashed tokens in Neon. Vercel provisions the
Auth0 tenant and application; OpenClasp does not store social-provider secrets.

## Vercel

1. Open the OpenClasp Vercel project and install the Auth0 Marketplace integration.
2. Connect it to Production, Preview, and Development.
3. Confirm Vercel created the Auth0 domain, client ID, and secret variables.
4. Redeploy after changing integration settings.

## Google and GitHub only

1. Open the linked tenant in Auth0 Dashboard.
2. Under **Authentication → Social**, configure Google and GitHub.
3. Enable both connections for the OpenClasp SPA application.
4. Disable the database connection for the OpenClasp dashboard application.
5. Configure `/sso-callback`, `/login`, and the production origin in the SPA application settings.

The app starts each provider directly and returns through `/sso-callback` to `/dashboard`.

## MCP OAuth

1. Create an Auth0 API with identifier `https://openclasp.vercel.app/mcp`.
2. Keep standard OIDC scopes enabled. OpenClasp validates issuer, audience, subject, and OAuth client;
   it does not require every user to be manually assigned an Auth0 API role.
3. Dynamic Client Registration in Auth0 is not required. OpenClasp registers MCP clients in Neon.
4. Set `OPENCLASP_PUBLIC_URL` to the canonical site origin and `OPENCLASP_MCP_URL` to its `/mcp`
   endpoint. Keep `AUTH0_AUDIENCE` set to the existing Auth0 API identifier when moving domains;
   the public callback origin and token audience are intentionally independent.
5. Connect an MCP client to the canonical `/mcp` endpoint. It discovers OpenClasp OAuth,
   authenticates the user through Auth0, and receives a hashed, revocable OpenClasp bearer token.

## Botpress provider connection

Botpress uses the dedicated OpenClasp integration, not an MCP bearer-token form:

1. Open **Connect → Botpress** in OpenClasp and enter only the agent name.
2. Copy the short-lived pairing code.
3. Install OpenClasp from the Botpress Hub, paste the code, and enable it.

The running agent supplies its profile. The integration registers the Botpress-managed webhook and
receives an agent-bound credential in the background. Do not paste a dashboard cookie or Auth0 token
into Botpress.

Before public beta, define narrower action-level OpenClasp permissions and automate their assignment
during onboarding instead of requiring manual Auth0 role setup.

## Smoke test

Test Google and GitHub separately in private browser windows. Each must end on `/dashboard`. Then
connect an MCP client and verify that an unauthenticated request receives a `401` with protected
resource metadata, while an approved OAuth token can list tools.
