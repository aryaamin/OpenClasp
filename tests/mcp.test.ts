import { describe, expect, it } from 'vitest';
import {
  HOSTED_OPENCLASP_TOOL_NAMES,
  OPENCLASP_MCP_INSTRUCTIONS,
  OPENCLASP_TOOL_NAMES,
  buildMcpServer,
} from '../packages/mcp-server/src/server.js';

describe('MCP surface', () => {
  it('constructs the complete server without schema composition failures', () => {
    expect(() => buildMcpServer()).not.toThrow();
  });

  it('exposes the complete documented tool set', () => {
    expect(OPENCLASP_TOOL_NAMES).toHaveLength(52);
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toHaveLength(51);
    expect(HOSTED_OPENCLASP_TOOL_NAMES).not.toContain('openclasp_create_identity');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_connect_to_agent');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_respond_invitation');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_get_live_session');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_record_session_event');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_heartbeat');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).not.toContain('openclasp_send_message');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_submit_completion_report');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_list_feedback_requests');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_submit_interaction_feedback');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_checkpoint');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_complete_live_session');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_resolve_agent');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_propose_contract_revision');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_respond_contract_revision');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_get_contextual_intelligence');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_recommend_agents');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_generate_assurance_probe');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_list_assurance_probes');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_submit_assurance_response');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_get_assurance_comparisons');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_get_assurance_brief');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_decide_assurance_safeguard');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_shield_open_case');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_shield_consult');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_shield_get_case');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_shield_list_cases');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_shield_close_case');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_assess_counterparty');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_verify_receipt');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_setup');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_get_identity');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_switch_agent');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_save_contract');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_permit_mediation');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_find_agent');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_search_agents');
    expect(OPENCLASP_MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    expect(OPENCLASP_MCP_INSTRUCTIONS).toContain('openclasp_connection_status');
  });
});
