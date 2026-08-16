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
        "download_progress_ctranslate2_weight": "/run/download_progress_ctranslate2_weight",
        "downloaded_ctranslate2_weight": "/run/downloaded_ctranslate2_weight",
        "error_ctranslate2_weight": "/run/error_ctranslate2_weight",
    }
    return controller


def _controller_for_selected_ctranslate2_readiness():
    controller = _controller_for_readiness()
    controller._ctranslate2_available_cache = False
    controller.updateTranslationEngineAndEngineList = Mock()
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

    def test_weight_check_logs_the_runtime_failure_before_returning_false(self):
        weight_type = "nllb-200-distilled-600M-ct2-int8"
        directory_name = translation_utils.ctranslate2_weights[weight_type]["directory_name"]

        with tempfile.TemporaryDirectory() as temporary_root:
            weight_path = Path(temporary_root, "weights", "ctranslate2", directory_name)
            weight_path.mkdir(parents=True)
            for filename in ("config.json", "model.bin", "shared_vocabulary.json"):
                (weight_path / filename).write_text("{}", encoding="utf-8")

            runtime = Mock()
            runtime.Translator.side_effect = RuntimeError("packaged CTranslate2 load failed")
            with (
                patch.object(translation_utils, "_getCtrTranslate2", return_value=runtime),
                patch.object(translation_utils, "errorLogging") as log_error,
            ):
                self.assertFalse(
                    translation_utils.checkCTranslate2Weight(temporary_root, weight_type)
                )

            log_error.assert_called_once()

    def test_tokenizer_check_logs_the_runtime_failure_before_returning_false(self):
        with (
            patch.object(
                translation_utils,
                "loadCTranslate2Tokenizer",
                side_effect=RuntimeError("packaged tokenizer load failed"),
            ),
            patch.object(translation_utils, "errorLogging") as log_error,
        ):
            self.assertFalse(
                translation_utils.checkCTranslate2Tokenizer(
                    "test-root",
                    "nllb-200-distilled-600M-ct2-int8",
                )
            )

            log_error.assert_called_once()

    def test_frozen_tokenizer_import_prefers_current_binary_over_stale_abi_binary(self):
        with tempfile.TemporaryDirectory() as temporary_root:
            package_path = Path(temporary_root, "tokenizers")
            package_path.mkdir()
            current_binary = package_path / "tokenizers.pyd"
            stale_binary = package_path / "tokenizers.cp311-win_amd64.pyd"
            current_binary.write_bytes(b"current")
            stale_binary.write_bytes(b"stale")

            finder = translation_utils._FrozenNativeModuleFinder(
                "tokenizers.tokenizers",
                str(current_binary),
            )
            module_spec = finder.find_spec(
                "tokenizers.tokenizers",
                [str(package_path)],
                None,
            )

            self.assertIsNotNone(module_spec)
            self.assertEqual(Path(module_spec.origin), current_binary)

    def test_frozen_tokenizer_cleanup_removes_only_stale_distribution_metadata(self):
        with tempfile.TemporaryDirectory() as temporary_root:
            current = Path(temporary_root, "tokenizers-0.22.2.dist-info")
            stale = Path(temporary_root, "tokenizers-0.19.1.dist-info")
            other = Path(temporary_root, "transformers-5.5.0.dist-info")
            for distribution, name, version in (
                (current, "tokenizers", "0.22.2"),
                (stale, "tokenizers", "0.19.1"),
                (other, "transformers", "5.5.0"),
            ):
                distribution.mkdir()
                (distribution / "METADATA").write_text(
                    f"Name: {name}\nVersion: {version}\n",
                    encoding="utf-8",
                )

            with patch.object(translation_utils.sys, "_MEIPASS", temporary_root, create=True):
                translation_utils._removeStaleFrozenTokenizersMetadata()

            self.assertTrue(current.is_dir())
            self.assertFalse(stale.exists())
            self.assertTrue(other.is_dir())

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

    def test_refreshing_selected_model_publishes_ready_status_and_cache(self):
        selected_weight = "m2m100_418M-ct2-int8"
        controller = _controller_for_selected_ctranslate2_readiness()
        with (
            patch.multiple(
                controller_module.config,
                _CTRANSLATE2_WEIGHT_TYPE=selected_weight,
                _SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT={selected_weight: False},
                _SELECTABLE_TRANSLATION_ENGINE_STATUS={"CTranslate2": False},
            ),
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelWeight",
                return_value=True,
            ) as weight_check,
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelTokenizer",
                return_value=True,
            ) as tokenizer_check,
        ):
            controller.updateDownloadedCTranslate2ModelWeight()
            weight_check.assert_called_once_with(selected_weight)
            tokenizer_check.assert_called_once_with(selected_weight)
            self.assertTrue(
                controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[
                    selected_weight
                ]
            )
            self.assertTrue(
                controller_module.config.SELECTABLE_TRANSLATION_ENGINE_STATUS[
                    "CTranslate2"
                ]
            )
            self.assertTrue(controller._ctranslate2_available_cache)
            controller.updateTranslationEngineAndEngineList.assert_called_once_with()

    def test_refreshing_selected_model_publishes_false_when_tokenizer_is_missing(self):
        selected_weight = "m2m100_418M-ct2-int8"
        controller = _controller_for_selected_ctranslate2_readiness()
        with (
            patch.multiple(
                controller_module.config,
                _CTRANSLATE2_WEIGHT_TYPE=selected_weight,
                _SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT={selected_weight: True},
                _SELECTABLE_TRANSLATION_ENGINE_STATUS={"CTranslate2": True},
            ),
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelWeight",
                return_value=True,
            ) as weight_check,
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelTokenizer",
                return_value=False,
            ) as tokenizer_check,
        ):
            controller.updateDownloadedCTranslate2ModelWeight()
            weight_check.assert_called_once_with(selected_weight)
            tokenizer_check.assert_called_once_with(selected_weight)
            self.assertFalse(
                controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[
                    selected_weight
                ]
            )
            self.assertFalse(
                controller_module.config.SELECTABLE_TRANSLATION_ENGINE_STATUS[
                    "CTranslate2"
                ]
            )
            self.assertFalse(controller._ctranslate2_available_cache)
            controller.updateTranslationEngineAndEngineList.assert_called_once_with()

    def test_model_selection_publishes_new_readiness_but_rejects_active_change(self):
        previous_weight = "m2m100_418M-ct2-int8"
        selected_weight = "nllb-200-distilled-1.3B-ct2-int8"
        controller = _controller_for_selected_ctranslate2_readiness()

        with (
            patch.multiple(
                controller_module.config,
                _ENABLE_TRANSLATION=True,
                _CTRANSLATE2_WEIGHT_TYPE=previous_weight,
                _SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT={
                    previous_weight: False,
                    selected_weight: False,
                },
                _SELECTABLE_TRANSLATION_ENGINE_STATUS={"CTranslate2": False},
            ),
            patch.object(
                model_module.model,
                "setChangedTranslatorParameters",
            ) as mark_changed,
        ):
            active_response = controller.setCtranslate2WeightType(selected_weight)
            self.assertEqual(active_response["status"], 400)
            self.assertEqual(
                active_response["result"]["error_code"],
                errors_module.ErrorCode.TRANSLATION_MODEL_CHANGE_ACTIVE.value,
            )
            self.assertEqual(
                controller_module.config.CTRANSLATE2_WEIGHT_TYPE,
                previous_weight,
            )
            mark_changed.assert_not_called()
            controller.updateTranslationEngineAndEngineList.assert_not_called()

        with (
            patch.multiple(
                controller_module.config,
                _ENABLE_TRANSLATION=False,
                _CTRANSLATE2_WEIGHT_TYPE=previous_weight,
                _SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT={
                    previous_weight: False,
                    selected_weight: False,
                },
                _SELECTABLE_TRANSLATION_ENGINE_STATUS={"CTranslate2": False},
            ),
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelWeight",
                return_value=True,
            ),
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelTokenizer",
                return_value=True,
            ),
            patch.object(
                model_module.model,
                "setChangedTranslatorParameters",
            ),
        ):
            inactive_response = controller.setCtranslate2WeightType(selected_weight)
            self.assertEqual(
                inactive_response,
                {"status": 200, "result": selected_weight},
            )
            self.assertTrue(
                controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[
                    selected_weight
                ]
            )
            self.assertTrue(
                controller_module.config.SELECTABLE_TRANSLATION_ENGINE_STATUS[
                    "CTranslate2"
                ]
            )
            self.assertTrue(controller._ctranslate2_available_cache)
            controller.updateTranslationEngineAndEngineList.assert_called_once_with()

    def test_verified_download_refreshes_selected_readiness_and_engine_list(self):
        selected_weight = "m2m100_418M-ct2-int8"
        controller = _controller_for_selected_ctranslate2_readiness()
        with (
            patch.multiple(
                controller_module.config,
                _CTRANSLATE2_WEIGHT_TYPE=selected_weight,
                _SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT={selected_weight: False},
                _SELECTABLE_TRANSLATION_ENGINE_STATUS={"CTranslate2": False},
            ),
            patch.object(
                model_module.model,
                "downloadCTranslate2ModelWeight",
                return_value=True,
            ),
            patch.object(
                model_module.model,
                "downloadCTranslate2ModelTokenizer",
            ),
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelWeight",
                return_value=True,
            ) as weight_check,
            patch.object(
                model_module.model,
                "checkTranslatorCTranslate2ModelTokenizer",
                return_value=True,
            ) as tokenizer_check,
        ):
            response = controller.downloadCtranslate2Weight(
                selected_weight,
                asynchronous=False,
            )
            self.assertEqual(response, {"status": 200, "result": True})
            weight_check.assert_called_once_with(selected_weight)
            tokenizer_check.assert_called_once_with(selected_weight)
            self.assertTrue(
                controller_module.config.SELECTABLE_CTRANSLATE2_WEIGHT_TYPE_DICT[
                    selected_weight
                ]
            )
            self.assertTrue(
                controller_module.config.SELECTABLE_TRANSLATION_ENGINE_STATUS[
                    "CTranslate2"
                ]
            )
            self.assertTrue(controller._ctranslate2_available_cache)
            controller.updateTranslationEngineAndEngineList.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
