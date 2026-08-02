import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.translation.translation_deepseek import (
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODELS,
    DeepSeekClient,
    DeepSeekProviderError,
)
from models.translation.translation_languages import loadTranslationLanguages


class FakeProviderException(Exception):
    def __init__(self, status_code=None, headers=None):
        super().__init__("provider request failed")
        self.status_code = status_code
        self.response = SimpleNamespace(headers=headers or {})


class ReasoningOnlyMessage:
    content = None

    @property
    def reasoning_content(self):
        raise AssertionError("translation must not access reasoning_content")


def completion_with(content):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


class DeepSeekClientTests(unittest.TestCase):
    def _configured_client(self, OpenAI):
        sdk_client = OpenAI.return_value
        sdk_client.models.list.return_value = SimpleNamespace(data=[])
        client = DeepSeekClient(root_path=".")
        self.assertTrue(client.setAuthKey("not-a-real-secret"))
        client.updateClient()
        return client, sdk_client.chat.completions.create

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_translation_uses_fixed_non_thinking_two_message_request(self, OpenAI):
        client, completion = self._configured_client(OpenAI)
        completion.return_value = completion_with("สวัสดี")

        translated = client.translate("hello", "English", "Thai", 5.0)

        self.assertEqual(translated, "สวัสดี")
        self.assertEqual(DEEPSEEK_BASE_URL, "https://api.deepseek.com")
        self.assertEqual(
            DEEPSEEK_MODELS,
            ("deepseek-v4-flash", "deepseek-v4-pro"),
        )
        for call in OpenAI.call_args_list:
            self.assertEqual(call.kwargs["base_url"], "https://api.deepseek.com")
        request = completion.call_args.kwargs
        self.assertEqual(request["model"], "deepseek-v4-flash")
        self.assertIs(request["stream"], False)
        self.assertEqual(request["extra_body"], {"thinking": {"type": "disabled"}})
        self.assertEqual(
            request["messages"],
            [
                {"role": "system", "content": unittest.mock.ANY},
                {"role": "user", "content": "hello"},
            ],
        )
        self.assertNotIn("tools", request)
        self.assertNotIn("response_format", request)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_model_selection_allows_only_flash_or_pro(self, OpenAI):
        client, _completion = self._configured_client(OpenAI)

        self.assertTrue(client.setModel("deepseek-v4-pro"))
        self.assertEqual(client.getModel(), "deepseek-v4-pro")
        self.assertFalse(client.setModel("deepseek-chat"))
        self.assertEqual(client.getModel(), "deepseek-v4-pro")
        self.assertEqual(client.getModelList(), ["deepseek-v4-flash", "deepseek-v4-pro"])

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_missing_empty_or_non_string_content_is_provider_failure(self, OpenAI):
        client, completion = self._configured_client(OpenAI)
        malformed_responses = (
            SimpleNamespace(choices=[]),
            SimpleNamespace(choices=[SimpleNamespace(message=None)]),
            completion_with(None),
            completion_with(["not", "text"]),
            completion_with("   "),
            SimpleNamespace(choices=[SimpleNamespace(message=ReasoningOnlyMessage())]),
        )

        for response in malformed_responses:
            with self.subTest(response=response):
                completion.return_value = response
                with self.assertRaisesRegex(DeepSeekProviderError, "malformed_response"):
                    client.translate("hello", "English", "Thai", 5.0)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_401_402_and_429_are_not_retried_and_are_categorized(self, OpenAI):
        client, completion = self._configured_client(OpenAI)
        cases = (
            (FakeProviderException(401), "invalid_credentials", None),
            (FakeProviderException(402), "insufficient_balance", None),
            (FakeProviderException(429, {"Retry-After": "7"}), "rate_limited", 7),
        )

        for error, category, retry_after in cases:
            with self.subTest(category=category):
                completion.reset_mock()
                completion.side_effect = error
                with self.assertRaises(DeepSeekProviderError) as raised:
                    client.translate("hello", "English", "Thai", 5.0)
                self.assertEqual(raised.exception.category, category)
                self.assertEqual(raised.exception.retry_after, retry_after)
                self.assertEqual(completion.call_count, 1)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_500_or_503_gets_at_most_one_additional_attempt(self, OpenAI):
        client, completion = self._configured_client(OpenAI)

        for status_code in (500, 503):
            with self.subTest(status_code=status_code):
                completion.reset_mock()
                completion.side_effect = [
                    FakeProviderException(status_code),
                    completion_with("translated"),
                ]
                self.assertEqual(client.translate("hello", "English", "Thai", 5.0), "translated")
                self.assertEqual(completion.call_count, 2)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_second_500_or_503_failure_stops_after_one_retry(self, OpenAI):
        client, completion = self._configured_client(OpenAI)

        for status_code in (500, 503):
            with self.subTest(status_code=status_code):
                completion.reset_mock()
                completion.side_effect = [
                    FakeProviderException(status_code),
                    FakeProviderException(status_code),
                ]
                with self.assertRaisesRegex(DeepSeekProviderError, "server_error"):
                    client.translate("hello", "English", "Thai", 5.0)
                self.assertEqual(completion.call_count, 2)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_timeout_is_not_retried(self, OpenAI):
        client, completion = self._configured_client(OpenAI)
        completion.side_effect = TimeoutError("request timed out")

        with self.assertRaisesRegex(DeepSeekProviderError, "timeout"):
            client.translate("hello", "English", "Thai", 5.0)

        self.assertEqual(completion.call_count, 1)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_network_failure_retries_once_then_stops(self, OpenAI):
        client, completion = self._configured_client(OpenAI)
        completion.side_effect = [ConnectionError("offline"), ConnectionError("offline")]

        with self.assertRaisesRegex(DeepSeekProviderError, "network_failure"):
            client.translate("hello", "English", "Thai", 5.0)

        self.assertEqual(completion.call_count, 2)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_prompt_disables_history(self, OpenAI):
        client, _completion = self._configured_client(OpenAI)

        self.assertEqual(
            client.history_cfg,
            {
                "use_history": False,
                "sources": [],
                "max_messages": 0,
                "max_chars": 0,
            },
        )
        self.assertFalse(hasattr(client, "setContextHistory"))

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_failed_connection_keeps_a_categorized_non_secret_error(self, OpenAI):
        OpenAI.return_value.models.list.side_effect = FakeProviderException(402)
        client = DeepSeekClient(root_path=".")

        self.assertFalse(client.setAuthKey("not-a-real-secret"))

        self.assertIsNone(client.getAuthKey())
        last_error = getattr(client, "last_error", None)
        self.assertIsNotNone(last_error)
        self.assertEqual(last_error.category, "insufficient_balance")
        self.assertEqual(last_error.status_code, 402)

    @patch("models.translation.translation_deepseek.OpenAI")
    def test_client_uses_current_language_mapping_after_a_forced_reload(self, OpenAI):
        loadTranslationLanguages(path=".", force=True)

        client, _completion = self._configured_client(OpenAI)

        self.assertIn("English", client.supported_languages)


if __name__ == "__main__":
    unittest.main()
