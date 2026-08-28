# MCP Tools

Run `corepack pnpm mcp` for the MCP v2 stdio server. It writes protocol output only to stdout and diagnostics to stderr.

Tools: `openclasp_create_identity`, `openclasp_register_agent`, `openclasp_get_profile`, `openclasp_assess_counterparty`, `openclasp_begin_interaction`, `openclasp_record_event`, `openclasp_check_claim`, `openclasp_validate_commitment`, `openclasp_suggest_resolution`, `openclasp_complete_interaction`, `openclasp_submit_feedback`, `openclasp_raise_dispute`, and `openclasp_verify_receipt`.

Tool inputs use the same Zod schemas as REST and the SDK. Do not place raw private conversations in structured-event payloads.
