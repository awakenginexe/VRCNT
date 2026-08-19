"""Helpers for downloading and loading Whisper (faster-whisper) models.

This module exposes small utilities used by the transcription subsystem:
- downloadFile: stream-download a file with optional progress callback
- checkWhisperWeight: quick local availability check
- downloadWhisperWeight: download model artifacts from HF hub
- getWhisperModel: construct and return a WhisperModel instance

The functions are defensive: failures are caught and reported by the caller.
"""

from os import path as os_path, makedirs as os_makedirs, remove as os_remove, replace as os_replace
import importlib
from requests import get as requests_get
from threading import Event
from typing import Callable, Optional
import huggingface_hub
import logging
import json
from utils import errorLogging, getBestComputeType
from .download_control import (
    DownloadCancelled,
    raise_if_download_cancelled,
    remove_incomplete_download,
)

logger = logging.getLogger('faster_whisper')
logger.setLevel(logging.CRITICAL)


def _getWhisperModelClass():
    return importlib.import_module("faster_whisper").WhisperModel

DEFAULT_WHISPER_WEIGHT_TYPE = "tiny"
WHISPER_GPU_INT8_COMPUTE_TYPE = "int8_float16"
WHISPER_BEAM_SIZES = {"fast": 1, "balanced": 2, "accurate": 5}

_MODELS = {
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v1": "Systran/faster-whisper-large-v1",
    "large-v2": "Systran/faster-whisper-large-v2",
    "large-v3": "Systran/faster-whisper-large-v3",
    "large-v3-turbo-int8": "Zoont/faster-whisper-large-v3-turbo-int8-ct2", #794MB
    "large-v3-turbo": "deepdml/faster-whisper-large-v3-turbo-ct2", #1.58GB
}

_FILENAMES = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.txt",
    "vocabulary.json",
]

_REQUIRED_WHISPER_FILES = ("config.json", "model.bin", "tokenizer.json")


def getWhisperBeamSize(profile) -> int:
    normalized_profile = str(profile).lower()
    return WHISPER_BEAM_SIZES.get(
        normalized_profile,
        WHISPER_BEAM_SIZES["balanced"],
    )


def resolveWhisperComputeType(device, device_index, requested) -> str:
    normalized_device = str(device).lower()
    normalized_requested = str(requested).lower()
    if normalized_device == "cuda" and normalized_requested in ("auto", "int8"):
        return WHISPER_GPU_INT8_COMPUTE_TYPE
    if normalized_requested != "auto":
        return normalized_requested
    return getBestComputeType(device=device, device_index=device_index)


def _normalizeWhisperComputeType(device: str, compute_type: str) -> str:
    """Backward-compatible normalization for callers with resolved requests."""
    return resolveWhisperComputeType(device, 0, compute_type)

def _isValidWhisperFile(file_path: str, filename: str) -> bool:
    if not os_path.isfile(file_path):
        return False
    try:
        file_size = os_path.getsize(file_path)
    except Exception:
        return False
    if filename == "model.bin":
        return file_size > 1024 * 1024
    if file_size <= 0:
        return False
    if filename.endswith(".json"):
        try:
            with open(file_path, "r", encoding="utf-8") as file:
                json.load(file)
        except Exception:
            return False
    return True


def _normalizeWhisperTokenizerFile(tokenizer_path: str) -> bool:
    """Rewrite Hugging Face array-form BPE merges for bundled tokenizers.

    Newer Hugging Face tokenizers can serialize each BPE merge as a two-item
    array.  The tokenizers version bundled with VRCNT 5.2.0 still expects the
    legacy space-separated string representation, and otherwise fails while
    faster-whisper constructs its tokenizer.  The conversion is lossless and
    keeps already-compatible tokenizer files untouched.
    """

    if not os_path.isfile(tokenizer_path):
        return False

    with open(tokenizer_path, "r", encoding="utf-8") as file:
        tokenizer = json.load(file)

    model = tokenizer.get("model")
    merges = model.get("merges") if isinstance(model, dict) else None
    if not isinstance(merges, list):
        return False

    normalized_merges = []
    changed = False
    for merge in merges:
        if isinstance(merge, list):
            if len(merge) != 2 or not all(isinstance(part, str) for part in merge):
                raise ValueError("Whisper tokenizer contains an invalid BPE merge")
            normalized_merges.append(f"{merge[0]} {merge[1]}")
            changed = True
        elif isinstance(merge, str):
            normalized_merges.append(merge)
        else:
            raise ValueError("Whisper tokenizer contains an invalid BPE merge")

    if not changed:
        return False

    model["merges"] = normalized_merges
    normalized_path = f"{tokenizer_path}.normalized"
    try:
        with open(normalized_path, "w", encoding="utf-8") as file:
            json.dump(tokenizer, file, ensure_ascii=False)
            file.write("\n")
        os_replace(normalized_path, tokenizer_path)
    except Exception:
        try:
            if os_path.exists(normalized_path):
                os_remove(normalized_path)
        except Exception:
            pass
        raise
    return True

def downloadFile(
    url: str,
    path: str,
    func: Optional[Callable[[float], None]] = None,
    cancel_event: Optional[Event] = None,
) -> bool:
    """Download a file from `url` to `path`.

    Args:
        url: remote URL to download from
        path: local filepath to write
        func: optional callback(progress: float) called with a 0.0-1.0 progress
    """
    temp_path = f"{path}.part"
    try:
        raise_if_download_cancelled(cancel_event)
        os_makedirs(os_path.dirname(path), exist_ok=True)
        with requests_get(url, stream=True, timeout=(10, 120)) as res:
            res.raise_for_status()
            file_size = int(res.headers.get('content-length', 0))
            total_chunk = 0
            with open(temp_path, 'wb') as file:
                for chunk in res.iter_content(chunk_size=1024 * 2000):
                    raise_if_download_cancelled(cancel_event)
                    if not chunk:
                        continue
                    file.write(chunk)
                    total_chunk += len(chunk)
                    if callable(func) and file_size:
                        func(total_chunk / file_size)
                    raise_if_download_cancelled(cancel_event)
            if total_chunk <= 0:
                raise IOError(f"Empty download for {path}")
            if file_size and total_chunk < file_size:
                raise IOError(f"Incomplete download for {path}: {total_chunk}/{file_size}")
        raise_if_download_cancelled(cancel_event)
        os_replace(temp_path, path)
        return True
    except DownloadCancelled:
        remove_incomplete_download(temp_path, False)
        remove_incomplete_download(path, False)
        return False
    except Exception:
        errorLogging()
        for broken_path in (temp_path, path):
            try:
                remove_incomplete_download(broken_path, False)
            except Exception:
                pass
        return False

def checkWhisperWeight(root: str, weight_type: str) -> bool:
    """Return True if all expected Whisper files for `weight_type` exist locally.

    Startup should avoid importing faster-whisper just to answer an
    availability question because that import is expensive and more fragile
    in frozen builds than a simple file check.
    """
    path = os_path.join(root, "weights", "whisper", weight_type)
    if not os_path.isdir(path):
        return False
    for filename in _REQUIRED_WHISPER_FILES:
        if not _isValidWhisperFile(os_path.join(path, filename), filename):
            return False
    if not (
        _isValidWhisperFile(os_path.join(path, "vocabulary.txt"), "vocabulary.txt")
        or _isValidWhisperFile(os_path.join(path, "vocabulary.json"), "vocabulary.json")
    ):
        return False
    return True

def downloadWhisperWeight(
    root: str,
    weight_type: str,
    callback: Optional[Callable[[float], None]] = None,
    end_callback: Optional[Callable[[], None]] = None,
    cancel_event: Optional[Event] = None,
) -> bool:
    """Ensure Whisper weight files are present locally; download them if missing.

    Args:
        root: project root where `weights/whisper` lives
        weight_type: key from `_MODELS` (eg. "tiny", "base")
        callback: progress callback for the main model file
        end_callback: called when download completes
    """
    path = os_path.join(root, "weights", "whisper", weight_type)
    os_makedirs(path, exist_ok=True)
    try:
        raise_if_download_cancelled(cancel_event)
        if not checkWhisperWeight(root, weight_type):
            try:
                filenames = [filename for filename in huggingface_hub.list_repo_files(_MODELS[weight_type]) if filename in _FILENAMES]
            except Exception:
                errorLogging()
                filenames = _FILENAMES

            for filename in filenames:
                raise_if_download_cancelled(cancel_event)
                file_path = os_path.join(path, filename)
                if _isValidWhisperFile(file_path, filename):
                    continue
                try:
                    if os_path.exists(file_path):
                        os_remove(file_path)
                except Exception:
                    pass
                url = huggingface_hub.hf_hub_url(_MODELS[weight_type], filename)
                download_result = downloadFile(
                    url,
                    file_path,
                    func=callback if filename == "model.bin" else None,
                    cancel_event=cancel_event,
                )
                if not download_result:
                    raise_if_download_cancelled(cancel_event)
        raise_if_download_cancelled(cancel_event)
        return checkWhisperWeight(root, weight_type)
    except DownloadCancelled:
        remove_incomplete_download(path, checkWhisperWeight(root, weight_type))
        return False
    finally:
        if callable(end_callback):
            end_callback()

def getWhisperModel(
    root: str,
    weight_type: str,
    device: str = "cpu",
    device_index: int = 0,
    compute_type: str = "auto",
) -> object:
    """Return a `WhisperModel` instance loaded from local weights.

    Raises:
        ValueError: when VRAM shortage is detected (wrapped from RuntimeError)
        Exception: other loading errors are propagated.
    """
    path = os_path.join(root, "weights", "whisper", weight_type)
    compute_type = resolveWhisperComputeType(device, device_index, compute_type)
    _normalizeWhisperTokenizerFile(os_path.join(path, "tokenizer.json"))
    whisper_model_class = _getWhisperModelClass()
    try:
        model = whisper_model_class(
            path,
            device=device,
            device_index=device_index,
            compute_type=compute_type,
            cpu_threads=4,
            num_workers=1,
            local_files_only=True,
        )
        return model
    except RuntimeError as e:
        # Detect VRAM out-of-memory-like errors and raise a clear ValueError
        error_message = str(e)
        if "CUDA out of memory" in error_message or "CUBLAS_STATUS_ALLOC_FAILED" in error_message:
            raise ValueError("VRAM_OUT_OF_MEMORY", error_message)
        raise


def unloadWhisperModel(model: object) -> None:
    """Explicitly unload a faster-whisper model's native CTranslate2 weights."""
    try:
        native_model = getattr(model, "model", None)
        unload_model = getattr(native_model, "unload_model", None)
        if callable(unload_model):
            unload_model()
    finally:
        del model

if __name__ == "__main__":
    def callback(value):
        print(value)
        pass

    def end_callback():
        print("end")
        pass

    downloadWhisperWeight("./", "tiny", callback, end_callback)
    downloadWhisperWeight("./", "base", callback, end_callback)
    downloadWhisperWeight("./", "small", callback, end_callback)
    downloadWhisperWeight("./", "medium", callback, end_callback)
    downloadWhisperWeight("./", "large-v1", callback, end_callback)
    downloadWhisperWeight("./", "large-v2", callback, end_callback)
    downloadWhisperWeight("./", "large-v3", callback, end_callback)
