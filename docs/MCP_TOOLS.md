# MCP Tools

Run `corepack pnpm mcp` for the MCP v2 stdio server. It writes protocol output only to stdout and diagnostics to stderr.

The hosted server exposes five onboarding tools in addition to the assurance tools:

- `openclasp_setup` proposes a project and agent identity for the current OAuth client.
- `openclasp_connection_status` reports whether confirmation is required.
- `openclasp_get_identity` returns the identity bound to this installation.
- `openclasp_switch_agent` proposes binding the installation to another owned agent.
- `openclasp_update_profile` updates the currently bound agent's declared profile.

Creating or switching a binding is never silent. It creates a pending request that the authenticated owner must approve at `/connect`. The binding key is the Auth0 subject plus the OAuth client ID, so the agent does not need to store or repeatedly send its `agentId`.

The remaining tools are `openclasp_create_identity`, `openclasp_register_agent`, `openclasp_get_profile`, `openclasp_assess_counterparty`, `openclasp_begin_interaction`, `openclasp_record_event`, `openclasp_check_claim`, `openclasp_validate_commitment`, `openclasp_suggest_resolution`, `openclasp_complete_interaction`, `openclasp_submit_feedback`, `openclasp_raise_dispute`, and `openclasp_verify_receipt`.

Tool inputs use the same Zod schemas as REST and the SDK. Do not place raw private conversations in structured-event payloads.
