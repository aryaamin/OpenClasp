import {
  DEFAULT_MCP_AUTH_SCOPES,
  OPENCLASP_AUTH_SCOPES,
  type OpenClaspAuthScope,
} from '../../../packages/protocol/src/index.js';

export { DEFAULT_MCP_AUTH_SCOPES, OPENCLASP_AUTH_SCOPES, type OpenClaspAuthScope };

const PROFILE_TOOLS = new Set([
  'openclasp_get_profile',
  'openclasp_assess_counterparty',
  'openclasp_check_claim',
  'openclasp_validate_commitment',
  'openclasp_suggest_resolution',
  'openclasp_verify_receipt',
  'openclasp_get_identity',
  'openclasp_connection_status',
  'openclasp_find_agent',
  'openclasp_search_agents',
  'openclasp_list_invitations',
  'openclasp_get_shared_interaction',
  'openclasp_get_live_session',
  'openclasp_list_threads',
  'openclasp_get_thread',
  'openclasp_list_feedback_requests',
  'openclasp_resolve_agent',
  'openclasp_get_contextual_intelligence',
  'openclasp_recommend_agents',
  'openclasp_list_assurance_probes',
  'openclasp_get_assurance_comparisons',
  'openclasp_get_assurance_brief',
  'openclasp_shield_get_case',
  'openclasp_shield_list_cases',
]);

const AGENT_TOOLS = new Set([
  'openclasp_register_agent',
  'openclasp_setup',
  'openclasp_switch_agent',
  'openclasp_update_profile',
  'openclasp_register_delegation',
  'openclasp_heartbeat',
]);

const FEEDBACK_TOOLS = new Set([
  'openclasp_complete_interaction',
  'openclasp_submit_feedback',
  'openclasp_complete_live_session',
  'openclasp_submit_completion_report',
  'openclasp_submit_interaction_feedback',
  'openclasp_shield_close_case',
]);

export function requiredMcpToolScope(name: string): OpenClaspAuthScope {
  if (PROFILE_TOOLS.has(name)) return 'profile:read';
  if (AGENT_TOOLS.has(name)) return 'agent:manage';
  if (FEEDBACK_TOOLS.has(name)) return 'feedback:write';
  return 'interaction:write';
}

export async function requiredMcpRequestScopes(request: Request): Promise<OpenClaspAuthScope[]> {
  if (request.method !== 'POST') return ['mcp:access'];
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return ['mcp:access'];
  }
  const messages = Array.isArray(body) ? body : [body];
  const scopes = new Set<OpenClaspAuthScope>(['mcp:access']);
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const rpc = message as { method?: unknown; params?: { name?: unknown } };
    if (rpc.method === 'tools/call' && typeof rpc.params?.name === 'string')
      scopes.add(requiredMcpToolScope(rpc.params.name));
  }
  return [...scopes];
}

export function requiredAgentApiScopes(
  method: string,
  url: string,
): OpenClaspAuthScope[] | undefined {
  const path = new URL(url, 'https://openclasp.local').pathname;
  if (/^\/v0\.1\/runtime(?:\/bootstrap|\/heartbeat)?$/.test(path))
    return method === 'GET' ? ['profile:read'] : ['runtime:connect'];
  if (path === '/v0.1/runtime/profile') return ['agent:manage'];
  if (path === '/v0.1/feedback-requests') return ['profile:read'];
  if (/^\/v0\.1\/shield\/cases(?:\/[^/]+)?$/.test(path) && method === 'GET')
    return ['profile:read'];
  if (/^\/v0\.1\/shield\/cases(?:\/[^/]+\/(?:consult|close))?$/.test(path))
    return method === 'POST' ? ['interaction:write'] : undefined;
  if (/^\/v0\.1\/federated-interactions\/[^/]+\/(?:brief|session)$/.test(path))
    return ['profile:read'];
  if (
    /^\/v0\.1\/federated-interactions\/[^/]+\/(?:assurance-probes|assurance-comparisons|assurance-brief)$/.test(
      path,
    ) &&
    method === 'GET'
  )
    return ['profile:read'];
  if (/^\/v0\.1\/federated-interactions\/[^/]+\/assurance-responses$/.test(path))
    return ['interaction:write'];
  if (/^\/v0\.1\/federated-interactions\/[^/]+\/assurance-safeguards\/[^/]+\/decision$/.test(path))
    return ['interaction:write'];
  if (/^\/v0\.1\/federated-interactions\/[^/]+\/(?:completion-reports|feedback)$/.test(path))
    return ['feedback:write'];
  if (
    /^\/v0\.1\/federated-interactions\/[^/]+\/contract-proposals(?:\/[^/]+\/respond)?$/.test(path)
  )
    return ['interaction:write'];
  return undefined;
}

export function assertScopes(granted: readonly string[], required: readonly string[]): void {
  const missing = required.filter((scope) => !granted.includes(scope));
  if (missing.length) throw new ScopeError(missing);
}

export class ScopeError extends Error {
  readonly statusCode = 403;

  constructor(readonly missingScopes: string[]) {
    super(`Credential is missing required scope: ${missingScopes.join(', ')}`);
  }
}
