import importlib
import json
import os
import re
import sys
import tempfile
import unittest
from unittest.mock import patch


SRC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_PYTHON not in sys.path:
    sys.path.insert(0, SRC_PYTHON)


def read_source(*parts):
    with open(os.path.join(SRC_PYTHON, *parts), encoding="utf-8") as source_file:
        return source_file.read()


class DualTranscriptionEngineContractTests(unittest.TestCase):
    def test_legacy_values_are_copied_to_both_source_settings_at_load_time(self):
        cpu_device = {
            "device": "cpu",
            "device_index": 0,
            "device_name": "cpu",
            "compute_types": ["auto", "float32"],
        }
        payload = {
            "SELECTED_TRANSCRIPTION_ENGINE": "Whisper",
            "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE": cpu_device,
            "SELECTED_TRANSCRIPTION_COMPUTE_TYPE": "float32",
            "WHISPER_WEIGHT_TYPE": "small",
            "VOSK_WEIGHT_TYPE": "vosk-en",
            "PARAKEET_WEIGHT_TYPE": "parakeet-v3",
            "SENSEVOICE_WEIGHT_TYPE": "sensevoice-int8",
            "WHISPER_DECODING_PROFILE": "accurate",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            previous_config_module = sys.modules.pop("config", None)
            try:
                with patch.dict(os.environ, {"LOCALAPPDATA": temp_dir}):
                    config_module = importlib.import_module("config")

                instance = object.__new__(config_module.Config)
                instance._PATH_CONFIG = os.path.join(temp_dir, "legacy-config.json")
                instance._config_data = {}
                instance._timer = None
                instance._SELECTABLE_TRANSCRIPTION_ENGINE_LIST = ["Google", "Whisper"]
                instance._SELECTABLE_COMPUTE_DEVICE_LIST = [cpu_device]
                instance._SELECTABLE_WHISPER_WEIGHT_TYPE_LIST = ["tiny", "small"]
                instance._SELECTABLE_VOSK_WEIGHT_TYPE_LIST = ["vosk-en"]
                instance._SELECTABLE_PARAKEET_WEIGHT_TYPE_LIST = ["parakeet-v3"]
                instance._SELECTABLE_SENSEVOICE_WEIGHT_TYPE_LIST = ["sensevoice-int8"]
                instance._SELECTED_TRANSCRIPTION_ENGINE = "Google"
                instance._SELECTED_TRANSCRIPTION_COMPUTE_DEVICE = dict(cpu_device)
                instance._SELECTED_TRANSCRIPTION_COMPUTE_TYPE = "auto"
                instance._WHISPER_WEIGHT_TYPE = "tiny"
                instance._VOSK_WEIGHT_TYPE = "vosk-en"
                instance._PARAKEET_WEIGHT_TYPE = "parakeet-v3"
                instance._SENSEVOICE_WEIGHT_TYPE = "sensevoice-int8"
                instance._WHISPER_DECODING_PROFILE = "balanced"
                instance._SELECTED_YOUR_LANGUAGES = {}
                instance._SELECTED_YOUR_TRANSLATION_LANGUAGES = {}
                instance.saveConfig = lambda key, value, immediate_save=False: instance._config_data.update({key: value})
                instance.saveConfigToFile = lambda: None
                with open(instance._PATH_CONFIG, "w", encoding="utf-8") as config_file:
                    json.dump(payload, config_file)

                config_module.Config.load_config(instance)

                self.assertEqual(instance.SELECTED_TRANSCRIPTION_ENGINE_SEND, "Whisper")
                self.assertEqual(instance.SELECTED_TRANSCRIPTION_ENGINE_RECEIVE, "Whisper")
                self.assertEqual(instance.SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_SEND, cpu_device)
                self.assertEqual(instance.SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_RECEIVE, cpu_device)
                self.assertEqual(instance.SELECTED_TRANSCRIPTION_COMPUTE_TYPE_SEND, "float32")
                self.assertEqual(instance.SELECTED_TRANSCRIPTION_COMPUTE_TYPE_RECEIVE, "float32")
                expected_profile = {
                    "engine": "Whisper",
                    "models": {
                        "Whisper": "small",
                        "Vosk": "vosk-en",
                        "Parakeet": "parakeet-v3",
                        "SenseVoice": "sensevoice-int8",
                    },
                    "device": cpu_device,
                    "compute_type": "float32",
                    "whisper_decoding_profile": "accurate",
                    "runtime_preferences": {
                        "Whisper": {
                            "device": cpu_device,
                            "compute_type": "float32",
                        },
                        "Parakeet": {
                            "device": cpu_device,
                            "compute_type": "auto",
                        },
                    },
                }
                self.assertEqual(instance.TRANSCRIPTION_PROFILE_SEND, expected_profile)
                self.assertEqual(instance.TRANSCRIPTION_PROFILE_RECEIVE, expected_profile)
            finally:
                sys.modules.pop("config", None)
                if previous_config_module is not None:
                    sys.modules["config"] = previous_config_module

    def test_legacy_global_engine_and_compute_values_migrate_to_both_sources(self):
        config_source = read_source("config.py")

        for name in (
            "SELECTED_TRANSCRIPTION_ENGINE_SEND",
            "SELECTED_TRANSCRIPTION_ENGINE_RECEIVE",
            "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_SEND",
            "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_RECEIVE",
            "SELECTED_TRANSCRIPTION_COMPUTE_TYPE_SEND",
            "SELECTED_TRANSCRIPTION_COMPUTE_TYPE_RECEIVE",
        ):
            self.assertIn(name, config_source)

        self.assertRegex(
            config_source,
            r'if "SELECTED_TRANSCRIPTION_ENGINE_SEND" not in self\._config_data[\s\S]{0,360}SELECTED_TRANSCRIPTION_ENGINE',
        )
        self.assertRegex(
            config_source,
            r'if "SELECTED_TRANSCRIPTION_COMPUTE_DEVICE_SEND" not in self\._config_data[\s\S]{0,360}SELECTED_TRANSCRIPTION_COMPUTE_DEVICE',
        )
        self.assertRegex(
            config_source,
            r'if "SELECTED_TRANSCRIPTION_COMPUTE_TYPE_SEND" not in self\._config_data[\s\S]{0,360}SELECTED_TRANSCRIPTION_COMPUTE_TYPE',
        )

    def test_source_routes_and_runtime_use_distinct_mic_and_speaker_settings(self):
        mainloop_source = read_source("mainloop.py")
        controller_source = read_source("controller.py")
        model_source = read_source("model.py")

        for endpoint in (
            "/get/data/selected_transcription_engine_send",
            "/set/data/selected_transcription_engine_send",
            "/get/data/selected_transcription_engine_receive",
            "/set/data/selected_transcription_engine_receive",
            "/get/data/selected_transcription_compute_device_send",
            "/set/data/selected_transcription_compute_device_send",
            "/get/data/selected_transcription_compute_device_receive",
            "/set/data/selected_transcription_compute_device_receive",
            "/get/data/selected_transcription_compute_type_send",
            "/set/data/selected_transcription_compute_type_send",
            "/get/data/selected_transcription_compute_type_receive",
            "/set/data/selected_transcription_compute_type_receive",
            "/get/data/transcription_profile_send",
            "/set/data/transcription_profile_send",
            "/get/data/transcription_profile_receive",
            "/set/data/transcription_profile_receive",
            "/get/data/transcription_profile_all",
            "/set/data/transcription_profile_all",
        ):
            self.assertIn(endpoint, mainloop_source)

        self.assertIn("getSelectedTranscriptionEngineSend", controller_source)
        self.assertIn("setSelectedTranscriptionEngineReceive", controller_source)
        self.assertIn("getSelectedTranscriptionComputeDeviceSend", controller_source)
        self.assertIn("setSelectedTranscriptionComputeTypeReceive", controller_source)
        self.assertIn("setTranscriptionProfileSend", controller_source)
        self.assertIn("setTranscriptionProfileReceive", controller_source)
        self.assertIn("setTranscriptionProfileAll", controller_source)
        self.assertRegex(model_source, r"PipelineSource\.MIC[\s\S]{0,180}SELECTED_TRANSCRIPTION_ENGINE_SEND")
        self.assertRegex(model_source, r"PipelineSource\.SPEAKER[\s\S]{0,180}SELECTED_TRANSCRIPTION_ENGINE_RECEIVE")

    def test_legacy_routes_remain_available_as_apply_to_both_compatibility(self):
        controller_source = read_source("controller.py")
        mainloop_source = read_source("mainloop.py")

        self.assertIn("def setSelectedTranscriptionEngine(self, data", controller_source)
        self.assertIn("def setSelectedTranscriptionComputeDevice(self, device", controller_source)
        self.assertIn("/set/data/selected_transcription_engine", mainloop_source)
        self.assertIn("/set/data/selected_transcription_compute_device", mainloop_source)
        self.assertIn("SELECTED_TRANSCRIPTION_ENGINE_SEND", controller_source)
        self.assertIn("SELECTED_TRANSCRIPTION_ENGINE_RECEIVE", controller_source)

    def test_deepseek_settings_routes_are_status_only_contract_routes(self):
        mainloop_source = read_source("mainloop.py")
        controller_source = read_source("controller.py")

        for endpoint in (
            "/get/data/deepseek_auth_key",
            "/set/data/deepseek_auth_key",
            "/delete/data/deepseek_auth_key",
            "/run/deepseek_connection",
            "/get/data/selectable_deepseek_model_list",
            "/get/data/selected_deepseek_model",
            "/set/data/selected_deepseek_model",
        ):
            self.assertIn(endpoint, mainloop_source)

        for method in (
            "getDeepSeekAuthKey",
            "setDeepSeekAuthKey",
            "delDeepSeekAuthKey",
            "checkDeepSeekConnection",
        ):
            self.assertIn(method, controller_source)

        self.assertRegex(
            mainloop_source,
            r'endpoint == "/set/data/deepseek_auth_key"[\s\S]{0,160}"\[redacted\]"',
        )


if __name__ == "__main__":
    unittest.main()
