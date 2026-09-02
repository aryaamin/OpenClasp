import { afterEach, describe, expect, it, vi } from 'vitest';
import { callOpenClaspTool, sendMcpA2ARequest } from '../connectors/botpress/src/mcp.js';

afterEach(() => vi.unstubAllGlobals());

describe('Botpress OpenClasp MCP bridge', () => {
  it('calls a tool with the paired bearer token and parses an SSE result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 'request',
          result: { content: [{ type: 'text', text: JSON.stringify({ ready: true }) }] },
        })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenClaspTool('https://openclasp.dev/', 'oc_at_secret', 'openclasp_search_agents', {
        query: 'buyer',
      }),
    ).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openclasp.dev/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer oc_at_secret' }),
      }),
    );
  });

  it('sends a returned MCP A2A request directly to the peer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendMcpA2ARequest({
        a2a: {
          endpoint: 'https://peer.example/a2a',
          bearerToken: 'session-token',
          request: {
            params: { message: { role: 'user', parts: [{ kind: 'data', data: {} }] } },
          },
        },
      }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://peer.example/a2a',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
