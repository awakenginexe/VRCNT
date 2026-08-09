"""Whisper Thai model catalog metadata.

The catalog is intentionally separate from the normal Whisper model map.  It
keeps display metadata and model-specific file requirements close to the Thai
download/validation policy without changing normal Whisper behavior.
"""

from __future__ import annotations

from copy import deepcopy
import os
from os import path as os_path

from huggingface_hub import hf_hub_url, list_repo_files

from .transcription_whisper import _isValidWhisperFile, downloadFile


THAI_WHISPER_MODELS = {
    "thai-thonburian-small": {
        "display_name": "Thonburian Thai Small (Experimental)",
        "repository": "Thaweewat/whisper-th-small-ct2",
        "repository_url": "https://huggingface.co/Thaweewat/whisper-th-small-ct2",
        "revision": "fe1f90dcade5fe4f6fa229047c7cf6d939bbb8bb",
        "source_model": "biodatlab/whisper-th-small-combined",
        "family": "BioDataLab / Thonburian Whisper",
        "converter": "Thaweewat",
        "license": "apache-2.0",
        "architecture": "openai/whisper-small",
        "quantization": "CTranslate2",
        "experimental": True,
        "required_files": (
            "config.json",
            "model.bin",
            "vocabulary.json",
            "tokenizer.json",
        ),
        "tokenizer_repository": "biodatlab/whisper-th-small-combined",
    },
    "thai-thonburian-medium": {
        "display_name": "Thonburian Thai Medium",
        "repository": "Vinxscribe/biodatlab-whisper-th-medium-faster",
        "repository_url": "https://huggingface.co/Vinxscribe/biodatlab-whisper-th-medium-faster",
        "revision": "704c0db154f842e8957a386323a69e70a630cb10",
        "source_model": "biodatlab/whisper-th-medium-combined",
        "family": "BioDataLab / Thonburian Whisper",
        "converter": "Vinxscribe",
        "license": "mit",
        "architecture": "openai/whisper-medium",
        "quantization": "CTranslate2",
        "experimental": False,
        "required_files": (
            "config.json",
            "model.bin",
            "preprocessor_config.json",
            "tokenizer.json",
            "vocabulary.json",
        ),
    },
    "thai-thonburian-large-v2": {
        "display_name": "Thonburian Thai Large V2",
        "repository": "mort666/faster-whisper-large-v2-th",
        "repository_url": "https://huggingface.co/mort666/faster-whisper-large-v2-th",
        "revision": "d1be0b5e37d98297946414e1dd25ffdf8174160e",
        "source_model": "biodatlab/whisper-th-large-combined",
        "family": "BioDataLab / Thonburian Whisper",
        "converter": "mort666",
        "license": "mit",
        "architecture": "openai/whisper-large-v2",
        "quantization": "CTranslate2",
        "experimental": False,
        "required_files": (
            "config.json",
            "model.bin",
            "tokenizer.json",
            "vocabulary.json",
        ),
    },
    "thai-thonburian-large-v3-int8": {
        "display_name": "Thonburian Thai Large V3 INT8",
        "repository": "Avocaduu14/whisper-th-large-v3-ct2",
        "repository_url": "https://huggingface.co/Avocaduu14/whisper-th-large-v3-ct2",
        "revision": "4ac21c3d2b48f846cd787272777d3f5e6156571d",
        "source_model": "biodatlab/whisper-th-large-v3-combined",
        "family": "BioDataLab / Thonburian Whisper",
        "converter": "Avocaduu14",
        "license": "apache-2.0",
        "architecture": "openai/whisper-large-v3",
        "quantization": "int8",
        "feature_size": 128,
        "experimental": False,
        "required_files": (
            "config.json",
            "model.bin",
            "preprocessor_config.json",
            "tokenizer.json",
            "vocabulary.json",
        ),
    },
    "thai-thonburian-distilled-large-v3": {
        "display_name": "Thonburian Thai Distilled Large V3",
        "repository": "pariya47/distill-whisper-th-large-v3-ct2",
        "repository_url": "https://huggingface.co/pariya47/distill-whisper-th-large-v3-ct2",
        "revision": "8c2a2e1caf92c41fb01e3a67f99a473e9817edfa",
        "source_model": "biodatlab/distill-whisper-th-large-v3",
        "family": "BioDataLab / Thonburian Whisper",
        "converter": "pariya47",
        "license": "mit",
        "architecture": "openai/whisper-large-v3",
        "quantization": "float16",
        "feature_size": 128,
        "experimental": False,
        "required_files": (
            "config.json",
            "model.bin",
            "preprocessor_config.json",
            "tokenizer.json",
            "vocabulary.json",
        ),
    },
    "thai-mort666-large-v3-fp16": {
        "display_name": "mort666 Thai Large V3 FP16",
        "repository": "mort666/whisper-large-v3-th-f16-faster",
        "repository_url": "https://huggingface.co/mort666/whisper-large-v3-th-f16-faster",
        "revision": "974c34759955a465e7ad24cf9456ec6671b57d47",
        "source_model": "mort666/whisper-large-v3-th-fp16",
        "family": "mort666 Thai Whisper fine-tune",
        "converter": "mort666",
        "license": "mit",
        "architecture": "openai/whisper-large-v3",
        "quantization": "float16",
        "feature_size": 128,
        "experimental": False,
        "required_files": (
            "config.json",
            "model.bin",
            "preprocessor_config.json",
            "tokenizer.json",
            "vocabulary.json",
        ),
    },
}

THAI_WHISPER_MODEL_IDS = tuple(THAI_WHISPER_MODELS)
DEFAULT_WHISPER_THAI_WEIGHT_TYPE = THAI_WHISPER_MODEL_IDS[0]


def getWhisperThaiModelMeta(weight_type: str) -> dict:
    """Return a defensive copy of one approved Thai model record."""

    try:
        return deepcopy(THAI_WHISPER_MODELS[str(weight_type)])
    except KeyError as error:
        raise ValueError(f"unknown Whisper Thai model: {weight_type}") from error


def getWhisperThaiModelCatalog() -> list[dict]:
    """Return the ordered catalog for backend and UI model surfaces."""

    return [
        {"id": model_id, **deepcopy(metadata)}
        for model_id, metadata in THAI_WHISPER_MODELS.items()
    ]


def _whisperThaiModelPath(root: str, weight_type: str) -> str:
    return os_path.join(root, "weights", "whisper", str(weight_type))


def checkWhisperThaiWeight(root: str, weight_type: str) -> bool:
    """Return whether one Thai model directory is locally self-contained."""

    metadata = getWhisperThaiModelMeta(weight_type)
    model_path = _whisperThaiModelPath(root, weight_type)
    if not os_path.isdir(model_path):
        return False
    for filename in metadata["required_files"]:
        if not _isValidWhisperFile(
            os_path.join(model_path, filename),
            filename,
        ):
            return False
    return True


def downloadWhisperThaiWeight(
    root: str,
    weight_type: str,
    callback=None,
    end_callback=None,
) -> bool:
    """Download one explicitly requested Thai model at its catalog revision."""

    metadata = getWhisperThaiModelMeta(weight_type)
    model_path = _whisperThaiModelPath(root, weight_type)
    os.makedirs(model_path, exist_ok=True)
    if not checkWhisperThaiWeight(root, weight_type):
        required_files = tuple(metadata["required_files"])
        try:
            repository_files = list_repo_files(
                metadata["repository"],
                revision=metadata["revision"],
            )
            filenames = [
                filename
                for filename in repository_files
                if filename in required_files
            ]
        except Exception:
            filenames = list(required_files)

        for filename in filenames:
            file_path = os_path.join(model_path, filename)
            if _isValidWhisperFile(file_path, filename):
                continue
            url = hf_hub_url(
                metadata["repository"],
                filename,
                revision=metadata["revision"],
            )
            downloadFile(
                url,
                file_path,
                func=callback if filename == "model.bin" else None,
            )
    if callable(end_callback):
        end_callback()
    return checkWhisperThaiWeight(root, weight_type)
