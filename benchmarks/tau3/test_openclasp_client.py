from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from openclasp_client import OpenClaspMcpClient, _split_policy


class Handler(BaseHTTPRequestHandler):
    authorization = ""
    tool_name = ""

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        Handler.authorization = self.headers.get("authorization", "")
        Handler.tool_name = body["params"]["name"]
        value = {"caseId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
        rpc = {
            "jsonrpc": "2.0",
            "id": body["id"],
            "result": {
                "content": [{"type": "text", "text": json.dumps(value)}]
            },
        }
        payload = f"data: {json.dumps(rpc)}\n\n".encode()
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        return


class OpenClaspClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()

    def test_calls_mcp_with_scoped_token_and_parses_sse(self):
        client = OpenClaspMcpClient(
            f"http://127.0.0.1:{self.server.server_port}",
            "oc_at_abcdefghijklmnop.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        )
        value = client.call_tool("openclasp_shield_list_cases")
        self.assertEqual(value["caseId"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        self.assertTrue(Handler.authorization.startswith("Bearer oc_at_"))
        self.assertEqual(Handler.tool_name, "openclasp_shield_list_cases")

    def test_policy_chunks_fit_protocol_limits(self):
        chunks = _split_policy(("policy line\n" * 600).strip())
        self.assertTrue(chunks)
        self.assertTrue(all(len(chunk) <= 1900 for chunk in chunks))
        self.assertEqual("\n".join(chunks).replace("\n", ""), ("policy line" * 600))


if __name__ == "__main__":
    unittest.main()
