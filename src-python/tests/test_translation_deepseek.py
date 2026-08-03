import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.translation.translation_deepseek import (
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODELS,
    DeepSeekClient,
    DeepSeekProviderError,
    redactDeepSeekDiagnostic,
)
from models.translation.translation_languages import loadTranslationLanguages
import controller as controller_module
from controller import Controller


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
    def test_pyinstaller_specs_bundle_the_dynamically_loaded_client(self):
        repository_root = Path(__file__).resolve().parents[2]

        for spec_name in ("backend.spec", "backend_cuda.spec"):
            with self.subTest(spec_name=spec_name):
                spec_source = (repository_root / "spec" / spec_name).read_text(
                    encoding="utf-8"
                )
                self.assertIn(
                    "'models.translation.translation_deepseek'",
                    spec_source,
                )

    def test_redaction_removes_bearer_tokens_and_api_key_values(self):
        marker = "not-a-real-secret"
        result = redactDeepSeekDiagnostic(
            f"Authorization: Bearer {marker}; api_key={marker}; api-key:{marker}"
        )

        self.assertNotIn(marker, result)
        self.assertEqual(
            result,
            "Authorization: Bearer [REDACTED]; api_key=[REDACTED]; api-key:[REDACTED]",
        )

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


class DeepSeekSettingsBackendTests(unittest.TestCase):
    def _config(self, deepseek_key=None):
        return SimpleNamespace(
            AUTH_KEYS={"DeepSeek_API": deepseek_key, "OpenAI_API": "other-provider-key"},
            SELECTABLE_TRANSLATION_ENGINE_STATUS={"DeepSeek_API": False, "OpenAI_API": True},
            SELECTABLE_DEEPSEEK_MODEL_LIST=list(DEEPSEEK_MODELS),
            SELECTED_DEEPSEEK_MODEL="deepseek-v4-flash",
            SELECTED_TRANSLATION_ENGINES={"1": "OpenAI_API"},
        )

    def _controller(self):
        instance = object.__new__(Controller)
        instance.run = Mock()
        instance.run_mapping = {
            "selectable_deepseek_model_list": "/run/selectable_deepseek_model_list",
            "selected_deepseek_model": "/run/selected_deepseek_model",
        }
        instance.updateTranslationEngineAndEngineList = Mock()
        return instance

    def _model(self):
        instance = Mock()
        instance.getTranslatorDeepSeekModelList.return_value = list(DEEPSEEK_MODELS)
        instance.setTranslatorDeepSeekModel.return_value = True
        instance.getTranslatorDeepSeekLastError.return_value = None
        return instance

    def test_key_save_replace_status_read_and_delete_never_return_the_key(self):
        fake_config = self._config()
        fake_model = self._model()
        fake_model.authenticationTranslatorDeepSeekAuthKey.return_value = True
        controller = self._controller()

        with patch.object(controller_module, "config", fake_config), patch.object(
            controller_module, "model", fake_model
        ):
            saved = controller.setDeepSeekAuthKey("not-a-real-secret")
            replaced = controller.setDeepSeekAuthKey("replacement-not-a-real-secret")
            hydrated = controller.getDeepSeekAuthKey()
            deleted = controller.delDeepSeekAuthKey()

        self.assertEqual(saved["status"], 200)
        self.assertEqual(replaced["status"], 200)
        self.assertNotIn("not-a-real-secret", repr(saved))
        self.assertNotIn("replacement-not-a-real-secret", repr(replaced))
        self.assertEqual(hydrated, {
            "status": 200,
            "result": {"configured": True, "health": "configured"},
        })
        self.assertEqual(deleted, {
            "status": 200,
            "result": {"configured": False, "health": "not_configured"},
        })
        self.assertIsNone(fake_config.AUTH_KEYS["DeepSeek_API"])
        self.assertNotIn("not-a-real-secret", repr(hydrated))
        self.assertEqual(fake_model.authenticationTranslatorDeepSeekAuthKey.call_count, 2)

    def test_401_and_402_are_provider_local_and_do_not_replace_saved_key(self):
        for category, error_code in (
            ("invalid_credentials", "AUTH_DEEPSEEK_INVALID"),
            ("insufficient_balance", "AUTH_DEEPSEEK_INSUFFICIENT_BALANCE"),
        ):
            with self.subTest(category=category):
                fake_config = self._config(deepseek_key="existing-not-a-real-secret")
                fake_model = self._model()
                fake_model.authenticationTranslatorDeepSeekAuthKey.return_value = False
                fake_model.getTranslatorDeepSeekLastError.return_value = SimpleNamespace(
                    category=category
                )
                controller = self._controller()

                with patch.object(controller_module, "config", fake_config), patch.object(
                    controller_module, "model", fake_model
                ):
                    response = controller.setDeepSeekAuthKey("replacement-not-a-real-secret")

                self.assertEqual(response["status"], 400)
                self.assertEqual(response["result"]["error_code"], error_code)
                self.assertEqual(fake_config.AUTH_KEYS["DeepSeek_API"], "existing-not-a-real-secret")
                self.assertEqual(fake_config.AUTH_KEYS["OpenAI_API"], "other-provider-key")
                self.assertNotIn("replacement-not-a-real-secret", repr(response))

    def test_unexpected_auth_initialization_failure_is_logged(self):
        fake_config = self._config()
        fake_model = self._model()
        fake_model.authenticationTranslatorDeepSeekAuthKey.side_effect = RuntimeError(
            "client initialization failed"
        )
        controller = self._controller()

        with patch.object(controller_module, "config", fake_config), patch.object(
            controller_module, "model", fake_model
        ), patch.object(controller_module, "errorLogging") as log_error:
            response = controller.setDeepSeekAuthKey("not-a-real-secret")

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["result"]["error_code"], "AUTH_DEEPSEEK_FAILED")
        log_error.assert_called_once_with()

    def test_connection_failure_is_status_only_and_preserves_provider_order(self):
        fake_config = self._config(deepseek_key="existing-not-a-real-secret")
        fake_model = self._model()
        fake_model.authenticationTranslatorDeepSeekAuthKey.return_value = False
        fake_model.getTranslatorDeepSeekLastError.return_value = SimpleNamespace(
            category="insufficient_balance"
        )
        controller = self._controller()
        order_before = dict(fake_config.SELECTED_TRANSLATION_ENGINES)

        with patch.object(controller_module, "config", fake_config), patch.object(
            controller_module, "model", fake_model
        ):
            response = controller.checkDeepSeekConnection()
            hydrated = controller.getDeepSeekAuthKey()

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["result"]["error_code"], "AUTH_DEEPSEEK_INSUFFICIENT_BALANCE")
        self.assertEqual(fake_config.AUTH_KEYS["DeepSeek_API"], "existing-not-a-real-secret")
        self.assertEqual(fake_config.SELECTED_TRANSLATION_ENGINES, order_before)
        controller.updateTranslationEngineAndEngineList.assert_not_called()
        self.assertEqual(hydrated["result"], {
            "configured": True,
            "health": "insufficient_balance",
        })
        self.assertNotIn("existing-not-a-real-secret", repr(response))

    def test_startup_availability_failure_preserves_saved_key_and_health(self):
        fake_config = self._config(deepseek_key="existing-not-a-real-secret")
        fake_model = self._model()
        fake_model.getTranslatorDeepSeekLastError.return_value = SimpleNamespace(
            category="invalid_credentials"
        )
        controller = self._controller()

        with patch.object(controller_module, "config", fake_config), patch.object(
            controller_module, "model", fake_model
        ):
            controller._setDeepSeekStartupAvailability(False)
            hydrated = controller.getDeepSeekAuthKey()

        self.assertEqual(fake_config.AUTH_KEYS["DeepSeek_API"], "existing-not-a-real-secret")
        self.assertFalse(fake_config.SELECTABLE_TRANSLATION_ENGINE_STATUS["DeepSeek_API"])
        self.assertEqual(hydrated["result"], {
            "configured": True,
            "health": "invalid_credentials",
        })

    def test_fixed_models_default_to_flash_and_reject_unknown_values(self):
        fake_config = self._config()
        fake_config.SELECTED_DEEPSEEK_MODEL = "retired-model"
        fake_model = self._model()
        controller = self._controller()

        with patch.object(controller_module, "config", fake_config), patch.object(
            controller_module, "model", fake_model
        ):
            self.assertEqual(
                controller.getDeepSeekModelList(),
                {"status": 200, "result": list(DEEPSEEK_MODELS)},
            )
            self.assertEqual(
                controller.getDeepSeekModel(),
                {"status": 200, "result": "deepseek-v4-flash"},
            )
            valid = controller.setDeepSeekModel("deepseek-v4-pro")
            invalid = controller.setDeepSeekModel("retired-model")

        self.assertEqual(valid, {"status": 200, "result": "deepseek-v4-pro"})
        self.assertEqual(invalid["status"], 400)
        self.assertEqual(invalid["result"]["error_code"], "MODEL_DEEPSEEK_INVALID")


if __name__ == "__main__":
    unittest.main()
