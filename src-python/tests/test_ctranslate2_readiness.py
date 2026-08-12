"""Regression tests for CTranslate2 readiness and active-model lifecycle rules."""

import hashlib
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
import errors as errors_module
import model as model_module
import models.translation.translation_utils as translation_utils
from models.translation.translation_languages import loadTranslationLanguages
from models.transcription.transcription_languages import transcription_lang
from controller import Controller


def _controller_for_readiness():
    controller = object.__new__(Controller)
    controller.device_access_status = True
    controller._transcription_restart_lock = threading.RLock()
    controller._translation_activation_lock = threading.RLock()
    controller._transcription_shutdown_requested = threading.Event()
    controller._transcription_shutdown_state = "running"
    controller.run = Mock()
    controller.run_mapping = {
        "error_translation_enable_vram_overflow": "/run/error/translation",
        "enable_translation": "/run/enable_translation",
        "initialization_status": "/run/initialization_status",
    }
    return controller


class CTranslate2ReadinessTests(unittest.TestCase):
    def test_balanced_model_has_a_translation_language_mapping(self):
        languages = loadTranslationLanguages(".", force=True)
        mappings = languages["CTranslate2"]
        self.assertIn("nllb-200-distilled-600M-ct2-int8", mappings)
        balanced = mappings["nllb-200-distilled-600M-ct2-int8"]

        self.assertIn("English", balanced["source"])
        self.assertIn("Japanese", balanced["target"])

    def test_madlad_does_not_expand_vrcnt_language_catalog(self):
        languages = loadTranslationLanguages(".", force=True)
        madlad_labels = set(
            languages["CTranslate2"]["madlad400-3b-mt-ct2-int8"]["source"]
        )

        self.assertTrue(madlad_labels <= set(transcription_lang))

    def test_readiness_is_not_ready_when_tokenizer_is_missing(self):
        with (
            patch.object(translation_utils, "checkCTranslate2Weight", return_value=True),
            patch.object(translation_utils, "checkCTranslate2Tokenizer", return_value=False),
        ):
            readiness = translation_utils.getCTranslate2ModelReadiness(
                "test-root",
                "m2m100_418M-ct2-int8",
            )

        self.assertEqual(
            readiness,
            {
                "weight_valid": True,
                "tokenizer_valid": False,
                "ready": False,
                "stage": "tokenizer",
                "retryable": True,
            },
        )

    def test_runtime_readiness_uses_local_tokenizer_only(self):
        fake_transformers = Mock()
        fake_transformers.AutoTokenizer.from_pretrained.return_value = object()

        with patch.object(translation_utils, "_getTransformers", return_value=fake_transformers):
            translation_utils.loadCTranslate2Tokenizer(
                "test-root",
                "m2m100_418M-ct2-int8",
                local_files_only=True,
            )

        self.assertTrue(
            fake_transformers.AutoTokenizer.from_pretrained.call_args.kwargs[
                "local_files_only"
            ]
        )

    def test_runtime_readiness_loads_an_existing_huggingface_snapshot_locally(self):
        fake_transformers = Mock()
        fake_transformers.AutoTokenizer.from_pretrained.return_value = object()

        with tempfile.TemporaryDirectory() as temporary_root:
            cache_root = (
                Path(temporary_root)
                / "weights"
                / "ctranslate2"
                / "m2m100_418M-ct2-int8"
                / "tokenizer"
            )
            snapshot = (
                cache_root
                / "models--facebook--m2m100_418M"
                / "snapshots"
                / "cached-revision"
            )
            snapshot.mkdir(parents=True)
            (snapshot / "tokenizer_config.json").write_text("{}", encoding="utf-8")

            with patch.object(
                translation_utils,
                "_getTransformers",
                return_value=fake_transformers,
            ):
                translation_utils.loadCTranslate2Tokenizer(
                    temporary_root,
                    "m2m100_418M-ct2-int8",
                    local_files_only=True,
                )

        call = fake_transformers.AutoTokenizer.from_pretrained.call_args
        self.assertEqual(call.args[0], str(snapshot))
        self.assertTrue(call.kwargs["local_files_only"])

    def test_manifest_verification_rejects_a_corrupt_weight_file(self):
        with tempfile.TemporaryDirectory() as temporary_root:
            model_root = Path(temporary_root)
            model_file = model_root / "model.bin"
            model_file.write_bytes(b"valid-model")
            manifest = {
                "files": [
                    {
                        "name": "model.bin",
                        "bytes": model_file.stat().st_size,
                        "sha256": hashlib.sha256(model_file.read_bytes()).hexdigest(),
                    },
                ],
            }
            (model_root / "manifest.json").write_text(
                json.dumps(manifest),
                encoding="utf-8",
            )

            verify_manifest = getattr(
                translation_utils,
                "verifyCTranslate2Manifest",
                lambda _path: False,
            )
            self.assertTrue(verify_manifest(str(model_root)))
            model_file.write_bytes(b"corrupt-model")
            self.assertFalse(verify_manifest(str(model_root)))

    def test_enable_returns_model_specific_readiness_error_before_loading(self):
        controller = _controller_for_readiness()
        with (
            patch.multiple(
                controller_module.config,
                _ENABLE_TRANSLATION=False,
                _ENABLE_CTRANSLATE2_AUTO_FALLBACK=False,
                _SELECTED_TAB_NO="1",
                _SELECTED_TRANSLATION_ENGINES={"1": "CTranslate2"},
                _CTRANSLATE2_WEIGHT_TYPE="m2m100_418M-ct2-int8",
            ),
            patch.object(model_module.model, "checkTranslatorCTranslate2ModelWeight", return_value=True),
            patch.object(model_module.model, "checkTranslatorCTranslate2ModelTokenizer", return_value=False),
            patch.object(model_module.model, "changeTranslatorCTranslate2Model") as load_model,
        ):
            response = controller.setEnableTranslation()

        self.assertEqual(response["status"], 400)
        self.assertEqual(
            response["result"]["error_code"],
            errors_module.ErrorCode.TRANSLATION_MODEL_NOT_READY.value,
        )
        self.assertEqual(response["result"]["data"]["weight_type"], "m2m100_418M-ct2-int8")
        self.assertFalse(response["result"]["data"]["tokenizer_valid"])
        load_model.assert_not_called()

    def test_active_translation_rejects_ctranslate2_model_change_without_reload(self):
        controller = _controller_for_readiness()
        previous_weight = "m2m100_418M-ct2-int8"
        with (
            patch.multiple(
                controller_module.config,
                _ENABLE_TRANSLATION=True,
                _SELECTED_TAB_NO="1",
                _SELECTED_TRANSLATION_ENGINES={"1": "CTranslate2"},
                _CTRANSLATE2_WEIGHT_TYPE=previous_weight,
            ),
            patch.object(model_module.model, "changeTranslatorCTranslate2Model") as load_model,
        ):
            response = controller.setCtranslate2WeightType(
                "nllb-200-distilled-1.3B-ct2-int8"
            )
            self.assertEqual(controller_module.config.CTRANSLATE2_WEIGHT_TYPE, previous_weight)
            load_model.assert_not_called()

        self.assertEqual(response["status"], 400)
        self.assertEqual(
            response["result"]["error_code"],
            errors_module.ErrorCode.TRANSLATION_MODEL_CHANGE_ACTIVE.value,
        )

    def test_enabling_active_local_fallback_returns_readiness_error(self):
        controller = _controller_for_readiness()
        with (
            patch.multiple(
                controller_module.config,
                _ENABLE_TRANSLATION=True,
                _ENABLE_CTRANSLATE2_AUTO_FALLBACK=False,
                _SELECTED_TAB_NO="1",
                _SELECTED_TRANSLATION_ENGINES={"1": "Google"},
                _CTRANSLATE2_WEIGHT_TYPE="m2m100_418M-ct2-int8",
            ),
            patch.object(model_module.model, "checkTranslatorCTranslate2ModelWeight", return_value=True),
            patch.object(model_module.model, "checkTranslatorCTranslate2ModelTokenizer", return_value=False),
            patch.object(model_module.model, "changeTranslatorCTranslate2Model") as load_model,
        ):
            response = controller.setCTranslate2AutoFallback(True)
            self.assertFalse(controller_module.config.ENABLE_CTRANSLATE2_AUTO_FALLBACK)
            load_model.assert_not_called()

        self.assertEqual(response["status"], 400)
        self.assertEqual(
            response["result"]["error_code"],
            errors_module.ErrorCode.TRANSLATION_MODEL_NOT_READY.value,
        )

    def test_download_status_is_not_ready_when_only_weights_are_valid(self):
        controller = object.__new__(Controller)
        original_status = dict(controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT)
        controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT = {
            "m2m100_418M-ct2-int8": False,
        }
        try:
            with patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelWeight",
                return_value=True,
            ), patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelTokenizer",
                return_value=False,
            ) as tokenizer_check:
                controller.updateDownloadedCTranslate2ModelWeight(scan_all=True)

            self.assertFalse(
                controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[
                    "m2m100_418M-ct2-int8"
                ]
            )
            tokenizer_check.assert_called_once_with("m2m100_418M-ct2-int8")
        finally:
            controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT = original_status


if __name__ == "__main__":
    unittest.main()
