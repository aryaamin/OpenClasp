import { describe, expect, it } from 'vitest';
import { OPENCLASP_TOOL_NAMES } from '../packages/mcp-server/src/server.js';

describe('MCP surface', () => {
  it('exposes the complete documented tool set', () => {
    expect(OPENCLASP_TOOL_NAMES).toHaveLength(18);
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_assess_counterparty');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_verify_receipt');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_setup');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_get_identity');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_switch_agent');
  });
});
