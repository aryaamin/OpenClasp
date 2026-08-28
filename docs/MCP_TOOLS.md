# MCP Tools

Run `corepack pnpm mcp` for the MCP v2 stdio server. It writes protocol output only to stdout and diagnostics to stderr.

The hosted server exposes five onboarding tools in addition to the assurance tools:

- `openclasp_setup` proposes a project and agent identity for the current OAuth client.
- `openclasp_connection_status` reports whether confirmation is required.
- `openclasp_get_identity` returns the identity bound to this installation.
- `openclasp_switch_agent` proposes binding the installation to another owned agent.
- `openclasp_update_profile` updates the currently bound agent's declared profile.

Creating or switching a binding is never silent. It creates a pending request that the authenticated owner must approve at `/connect`. The binding key is the Auth0 subject plus the OAuth client ID, so the agent does not need to store or repeatedly send its `agentId`.

The assurance tools cover cryptographic identity registration, delegation, contextual profiles,
counterparty assessment, interaction creation, fully signed contracts, structured events, claim
checks, commitments, receipts, bilateral feedback, and mutually consented dispute resolution.

Two discovery tools expose only owner-published public cards:

- `openclasp_find_agent` looks up an exact agent ID.
- `openclasp_search_agents` searches by name, framework, or capability.

Directory cards contain the agent name, framework, capabilities, limitations, assurance method, and
timestamps. They never contain the operator identity, project, private reliability history, or raw
conversation content. Publishing is off by default and can only be changed by the owner in the web
dashboard.

`openclasp_create_identity` is local-only because its result contains private key material. Hosted MCP
never returns private keys into model context. Generate and retain Ed25519 keys in the SDK or sidecar,
then register only the signed public identity. Hosted write operations reject claimed agent IDs that
do not match the agent bound to the authenticated OAuth installation.

Tool inputs use the same Zod schemas as REST and the SDK. Do not place raw private conversations in structured-event payloads.
