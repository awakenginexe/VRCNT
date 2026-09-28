"""Offline compatibility checks for the pinned chat provider packages."""

import importlib
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _LocalChatHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.requests.append(json.loads(body))
        response = {
            "id": "chatcmpl-local-test",
            "object": "chat.completion",
            "created": 1,
            "model": "test-model",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": "translated"},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
        }
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_args):
        pass


class ChatProviderDependencyCompatibilityTests(unittest.TestCase):
    def test_openai_compatible_clients_construct_without_remote_requests(self):
        cases = (
            ("translation_openai", "OpenAIClient", "openai_llm"),
            ("translation_openrouter", "OpenRouterClient", "openrouter_llm"),
            ("translation_groq", "GroqClient", "groq_llm"),
            ("translation_plamo", "PlamoClient", "plamo_llm"),
            ("translation_lmstudio", "LMStudioClient", "openai_llm"),
        )
        for module_name, class_name, client_attribute in cases:
            with self.subTest(provider=module_name):
                module = importlib.import_module(
                    f"models.translation.{module_name}"
                )
                client = object.__new__(getattr(module, class_name))
                client.api_key = "local-test-key"
                client.model = "test-model"
                client.base_url = "http://127.0.0.1:1/v1"
                client.updateClient()
                self.assertIsNotNone(getattr(client, client_attribute))

    def test_openai_compatible_translation_uses_local_completion(self):
        from models.translation.translation_openai import OpenAIClient

        server = ThreadingHTTPServer(("127.0.0.1", 0), _LocalChatHandler)
        server.requests = []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = object.__new__(OpenAIClient)
            client.api_key = "local-test-key"
            client.model = "test-model"
            client.base_url = f"http://127.0.0.1:{server.server_port}/v1"
            client.prompt_template = "Translate {input_lang} to {output_lang}."
            client.supported_languages = ["English", "French"]
            client.history_cfg = {"use_history": False}
            client._context_history = []
            client.updateClient()

            result = client.translate("hello", "English", "French")
            self.assertEqual(result, "translated")
            self.assertEqual(len(server.requests), 1)
            self.assertEqual(
                [item["role"] for item in server.requests[0]["messages"]],
                ["system", "user"],
            )
            self.assertEqual(server.requests[0]["messages"][1]["content"], "hello")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_gemini_and_ollama_clients_construct_without_remote_requests(self):
        cases = (
            ("translation_gemini", "GeminiClient", "gemini_llm"),
            ("translation_ollama", "OllamaClient", "openai_llm"),
        )
        for module_name, class_name, client_attribute in cases:
            with self.subTest(provider=module_name):
                module = importlib.import_module(
                    f"models.translation.{module_name}"
                )
                client = object.__new__(getattr(module, class_name))
                client.api_key = "local-test-key"
                client.model = "test-model"
                client.base_url = "http://127.0.0.1:1"
                client.updateClient()
                self.assertIsNotNone(getattr(client, client_attribute))


if __name__ == "__main__":
    unittest.main()
