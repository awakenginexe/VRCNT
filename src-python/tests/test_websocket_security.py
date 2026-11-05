import asyncio
import os
import sys
import unittest
from urllib.parse import urlsplit, parse_qs
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from models.websocket.websocket_server import WebSocketServer


class WebSocketSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_missing_and_wrong_token_and_accepts_valid_token(self):
        server = WebSocketServer(token="test-token")
        responses = []
        connection = SimpleNamespace(respond=lambda code, text: responses.append(code) or code)
        for path in ("/", "/?token=wrong", "/?token=test-token&token=wrong"):
            result = await server._process_request(connection, SimpleNamespace(path=path))
            self.assertEqual(int(result), 403)
        self.assertIsNone(await server._process_request(connection, SimpleNamespace(path="/?token=test-token")))

    async def test_real_server_rejects_unauthenticated_handshake(self):
        import websockets
        server = WebSocketServer(token="test-token")
        async with websockets.serve(server._handler, "127.0.0.1", 0, process_request=server._process_request) as listener:
            port = listener.sockets[0].getsockname()[1]
            with self.assertRaises(websockets.exceptions.InvalidStatus):
                async with websockets.connect(f"ws://127.0.0.1:{port}/"):
                    pass
            async with websockets.connect(f"ws://127.0.0.1:{port}/?token=test-token") as client:
                await asyncio.sleep(0)
                await server._broadcast_async("hello")
                self.assertEqual(await asyncio.wait_for(client.recv(), 1), "hello")

    async def test_rejects_wildcard_bind(self):
        for host in ("0.0.0.0", "::"):
            with self.assertRaises(ValueError):
                WebSocketServer(host=host, token="test-token")

    async def test_saved_wildcard_hosts_migrate_to_loopback(self):
        from config import _websocket_host_validator
        self.assertEqual(_websocket_host_validator("0.0.0.0", None), "127.0.0.1")
        self.assertEqual(_websocket_host_validator("::", None), "127.0.0.1")
        self.assertEqual(_websocket_host_validator("192.168.1.2", None), "192.168.1.2")
        self.assertIsNone(_websocket_host_validator("invalid", None))

    async def test_generated_url_handles_ipv6(self):
        server = WebSocketServer(host="::1", port=2231, token="test-token")
        self.assertEqual(server.url, "ws://[::1]:2231/?token=test-token")


class CredentialLoggingTests(unittest.TestCase):
    def test_all_api_keys_and_websocket_token_are_redacted_in_diagnostics(self):
        from utils import redact_endpoint_payload
        for endpoint in ("/get/data/websocket_token", "/set/data/gemini_auth_key", "/get/data/openai_auth_key", "/delete/data/deepseek_auth_key"):
            self.assertEqual(redact_endpoint_payload(endpoint, "sensitive"), "[redacted]")
        payload = {"normal": "value"}
        self.assertIs(redact_endpoint_payload("/get/data/websocket_host", payload), payload)


if __name__ == "__main__":
    unittest.main()
