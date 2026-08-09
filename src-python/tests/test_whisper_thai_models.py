import os
import sys
import json
import tempfile
import unittest
from unittest.mock import patch


SRC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_PYTHON not in sys.path:
    sys.path.insert(0, SRC_PYTHON)

from models.transcription.transcription_whisper_thai import (
    THAI_WHISPER_MODEL_IDS,
    getWhisperThaiModelCatalog,
    getWhisperThaiModelMeta,
)
import models.transcription.transcription_whisper_thai as whisper_thai


class WhisperThaiCatalogTests(unittest.TestCase):
    def test_catalog_has_the_six_approved_models_in_order(self):
        self.assertEqual(
            THAI_WHISPER_MODEL_IDS,
            (
                "thai-thonburian-small",
                "thai-thonburian-medium",
                "thai-thonburian-large-v2",
                "thai-thonburian-large-v3-int8",
                "thai-thonburian-distilled-large-v3",
                "thai-mort666-large-v3-fp16",
            ),
        )
        self.assertEqual(
            [model["display_name"] for model in getWhisperThaiModelCatalog()],
            [
                "Thonburian Thai Small (Experimental)",
                "Thonburian Thai Medium",
                "Thonburian Thai Large V2",
                "Thonburian Thai Large V3 INT8",
                "Thonburian Thai Distilled Large V3",
                "mort666 Thai Large V3 FP16",
            ],
        )

    def test_only_thai_small_is_marked_experimental(self):
        catalog = getWhisperThaiModelCatalog()

        self.assertEqual(
            [model["id"] for model in catalog if model["experimental"]],
            ["thai-thonburian-small"],
        )
        self.assertEqual(
            getWhisperThaiModelMeta("thai-mort666-large-v3-fp16")["family"],
            "mort666 Thai Whisper fine-tune",
        )

    def test_catalog_returns_defensive_metadata_copies(self):
        metadata = getWhisperThaiModelMeta("thai-thonburian-small")
        metadata["display_name"] = "changed"

        self.assertEqual(
            getWhisperThaiModelMeta("thai-thonburian-small")["display_name"],
            "Thonburian Thai Small (Experimental)",
        )

    def test_small_catalog_pins_authoritative_tokenizer_source(self):
        metadata = getWhisperThaiModelMeta("thai-thonburian-small")

        self.assertEqual(
            metadata["tokenizer_repository"],
            "biodatlab/whisper-th-small-combined",
        )
        self.assertEqual(
            metadata["tokenizer_revision"],
            "956bcd8fbcb69c053b3116e2f21c636db5510a79",
        )


class WhisperThaiValidationTests(unittest.TestCase):
    @staticmethod
    def _write_model(root, model_id, *, include_tokenizer=True):
        model_root = os.path.join(root, "weights", "whisper", model_id)
        os.makedirs(model_root, exist_ok=True)
        with open(os.path.join(model_root, "config.json"), "w", encoding="utf-8") as file:
            json.dump({"lang_ids": {"<|th|>": 50259}}, file)
        with open(os.path.join(model_root, "vocabulary.json"), "w", encoding="utf-8") as file:
            json.dump(["<|endoftext|>", "<|th|>", "<|transcribe|>"], file)
        with open(os.path.join(model_root, "preprocessor_config.json"), "w", encoding="utf-8") as file:
            json.dump({"feature_size": 128}, file)
        with open(os.path.join(model_root, "model.bin"), "wb") as file:
            file.write(b"model" * 300000)
        if include_tokenizer:
            with open(os.path.join(model_root, "tokenizer.json"), "w", encoding="utf-8") as file:
                json.dump({"model": {"vocab": {"<|th|>": 50259}}}, file)
        return model_root

    def test_complete_thai_model_requires_all_runtime_files(self):
        self.assertTrue(callable(getattr(whisper_thai, "checkWhisperThaiWeight", None)))

        with tempfile.TemporaryDirectory() as root:
            self._write_model(root, "thai-thonburian-large-v3-int8")

            self.assertTrue(
                whisper_thai.checkWhisperThaiWeight(
                    root,
                    "thai-thonburian-large-v3-int8",
                )
            )

    def test_small_without_tokenizer_is_not_marked_ready(self):
        check = getattr(whisper_thai, "checkWhisperThaiWeight", None)
        self.assertTrue(callable(check))
        if not callable(check):
            return
        with tempfile.TemporaryDirectory() as root:
            self._write_model(
                root,
                "thai-thonburian-small",
                include_tokenizer=False,
            )

            self.assertFalse(
                check(
                    root,
                    "thai-thonburian-small",
                )
            )

    def test_unknown_thai_model_is_rejected_without_network_access(self):
        check = getattr(whisper_thai, "checkWhisperThaiWeight", None)
        self.assertTrue(callable(check))
        if not callable(check):
            return
        with self.assertRaises(ValueError):
            check("unused-root", "not-a-thai-model")

    def test_download_uses_the_catalog_revision_and_only_requested_model(self):
        download_function = getattr(whisper_thai, "downloadWhisperThaiWeight", None)
        self.assertTrue(callable(download_function))
        if not callable(download_function):
            return

        with (
            patch.object(whisper_thai, "list_repo_files", return_value=[
                "config.json",
                "model.bin",
                "tokenizer.json",
                "vocabulary.json",
            ]),
            patch.object(whisper_thai, "hf_hub_url", side_effect=lambda repo, filename, revision=None: (repo, filename, revision)),
            patch.object(whisper_thai, "downloadFile", return_value=True) as download,
            patch.object(whisper_thai, "checkWhisperThaiWeight", return_value=False),
        ):
            result = download_function(
                "unused-root",
                "thai-thonburian-large-v3-int8",
            )

        self.assertFalse(result)
        self.assertEqual(
            {call.args[0] for call in download.call_args_list},
            {
                (
                    "Avocaduu14/whisper-th-large-v3-ct2",
                    "config.json",
                    "4ac21c3d2b48f846cd787272777d3f5e6156571d",
                ),
                (
                    "Avocaduu14/whisper-th-large-v3-ct2",
                    "model.bin",
                    "4ac21c3d2b48f846cd787272777d3f5e6156571d",
                ),
                (
                    "Avocaduu14/whisper-th-large-v3-ct2",
                    "tokenizer.json",
                    "4ac21c3d2b48f846cd787272777d3f5e6156571d",
                ),
                (
                    "Avocaduu14/whisper-th-large-v3-ct2",
                    "vocabulary.json",
                    "4ac21c3d2b48f846cd787272777d3f5e6156571d",
                ),
            },
        )

    def test_small_download_assembles_tokenizer_from_authoritative_source_repo(self):
        with tempfile.TemporaryDirectory() as root:
            model_root = os.path.join(
                root,
                "weights",
                "whisper",
                "thai-thonburian-small",
            )

            def repository_files(repository, revision=None):
                if repository == "Thaweewat/whisper-th-small-ct2":
                    return ["config.json", "model.bin", "vocabulary.json"]
                if repository == "biodatlab/whisper-th-small-combined":
                    return ["tokenizer.json", "config.json"]
                raise AssertionError(repository)

            with (
                patch.object(
                    whisper_thai,
                    "list_repo_files",
                    side_effect=repository_files,
                ),
                patch.object(
                    whisper_thai,
                    "hf_hub_url",
                    side_effect=lambda repo, filename, revision=None: (
                        repo,
                        filename,
                        revision,
                    ),
                ),
                patch.object(
                    whisper_thai,
                    "downloadFile",
                    return_value=True,
                ) as download,
                patch.object(
                    whisper_thai,
                    "checkWhisperThaiWeight",
                    return_value=False,
                ),
            ):
                whisper_thai.downloadWhisperThaiWeight(
                    root,
                    "thai-thonburian-small",
                )

        self.assertIn(
            (
                "biodatlab/whisper-th-small-combined",
                "tokenizer.json",
                "956bcd8fbcb69c053b3116e2f21c636db5510a79",
            ),
            {call.args[0] for call in download.call_args_list},
        )
        self.assertNotIn(
            (
                "Thaweewat/whisper-th-small-ct2",
                "tokenizer.json",
                "fe1f90dcade5fe4f6fa229047c7cf6d939bbb8bb",
            ),
            {call.args[0] for call in download.call_args_list},
        )


if __name__ == "__main__":
    unittest.main()
