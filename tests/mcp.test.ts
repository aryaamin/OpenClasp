import { describe, expect, it } from 'vitest';
import { OPENCLASP_TOOL_NAMES } from '../packages/mcp-server/src/server.js';

describe('MCP surface', () => {
  it('exposes the complete documented tool set', () => {
    expect(OPENCLASP_TOOL_NAMES).toHaveLength(13);
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_assess_counterparty');
    expect(OPENCLASP_TOOL_NAMES).toContain('openclasp_verify_receipt');
  });
});
