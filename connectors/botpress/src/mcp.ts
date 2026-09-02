import * as sdk from '@botpress/sdk';

type Json = Record<string, any>;

const rpcResponse = (body: string): Json => {
  const candidates = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  const raw = candidates.at(-1) ?? body;
  try {
    return JSON.parse(raw) as Json;
  } catch {
    throw new sdk.RuntimeError('OpenClasp returned an invalid MCP response');
  }
};

export const callOpenClaspTool = async <T = Json>(
  baseUrl: string,
  token: string,
  name: string,
  args: Json = {},
): Promise<T> => {
  if (!token) throw new sdk.RuntimeError('OpenClasp pairing is not complete');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const payload = rpcResponse(await response.text());
  if (!response.ok || payload.error)
    throw new sdk.RuntimeError(
      String(payload.error?.message ?? `OpenClasp MCP HTTP ${response.status}`),
    );
  const result = payload.result as Json | undefined;
  if (result?.isError)
    throw new sdk.RuntimeError(String(result.content?.[0]?.text ?? 'OpenClasp tool failed'));
  const text = result?.content?.find((item: Json) => item.type === 'text')?.text;
  if (typeof text !== 'string') return result as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
};

export const sendMcpA2ARequest = async (value: Json): Promise<boolean> => {
  const a2a = value.a2a as Json | undefined;
  const endpoint = a2a?.endpoint;
  const bearerToken = a2a?.bearerToken;
  const request = a2a?.request ?? a2a?.requestTemplate;
  if (typeof endpoint !== 'string' || typeof bearerToken !== 'string' || !request) return false;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearerToken}`,
      'content-type': 'application/json',
      'A2A-Extensions': 'https://openclasp.dev/extensions/trust/v0.1',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/send',
      params: request.params ?? { message: request.message },
    }),
  });
  if (!response.ok)
    throw new sdk.RuntimeError(`Peer A2A endpoint returned HTTP ${response.status}`);
  return true;
};
