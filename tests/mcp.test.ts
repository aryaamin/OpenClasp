import { describe, expect, it } from 'vitest';
import {
  HOSTED_OPENCLASP_TOOL_NAMES,
  OPENCLASP_MCP_INSTRUCTIONS,
  OPENCLASP_TOOL_NAMES,
} from '../packages/mcp-server/src/server.js';

describe('MCP surface', () => {
  it('exposes the complete documented tool set', () => {
    expect(OPENCLASP_TOOL_NAMES).toHaveLength(32);
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toHaveLength(31);
    expect(HOSTED_OPENCLASP_TOOL_NAMES).not.toContain('openclasp_create_identity');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_connect_to_agent');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_respond_invitation');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_inbox');
    expect(HOSTED_OPENCLASP_TOOL_NAMES).toContain('openclasp_heartbeat');
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
