import hashlib
import json
import os
import shutil
from os import path as os_path
from os import makedirs as os_makedirs
from os import rename as os_rename
from os import replace as os_replace
from os import remove as os_remove
import importlib
import importlib.util
import sys
from requests import get as requests_get
from typing import Callable
from huggingface_hub import hf_hub_url, list_repo_files
import yaml

try:
    from utils import errorLogging, getBestComputeType
except Exception:
    print(os_path.dirname(os_path.dirname(os_path.dirname(os_path.abspath(__file__)))))
    sys.path.append(os_path.dirname(os_path.dirname(os_path.dirname(os_path.abspath(__file__)))))
    from utils import errorLogging, getBestComputeType


"""Utilities for downloading and verifying CTranslate2 weights and tokenizers.

This module provides a small, dependency-light set of helpers used by the
translation layer. It purposely keeps behavior resilient: network errors are
logged (via utils.errorLogging) and the functions return/complete without
raising, which matches the repository's defensive style.
"""

ctranslate2_weights = {
    "m2m100_418M-ct2-int8": {
        "hf_repo": "jncraton/m2m100_418M-ct2-int8",
        "directory_name": "m2m100_418M-ct2-int8",
        "tokenizer": "facebook/m2m100_418M",
        "display_name": "M2M100 418M",
        "family": "m2m100",
        "size_mb": 450,
        "quantization": "INT8",
        "license": "MIT",
        "language_coverage": "75+ languages",
    },
    "m2m100_1.2B-ct2-int8": {
        "hf_repo": "jncraton/m2m100_1.2B-ct2-int8",
        "directory_name": "m2m100_1.2B-ct2-int8",
        "tokenizer": "facebook/m2m100_1.2B",
        "display_name": "M2M100 1.2B",
        "family": "m2m100",
        "size_mb": 1300,
        "quantization": "INT8",
        "license": "MIT",
        "language_coverage": "75+ languages",
    },
    "nllb-200-distilled-600M-ct2-int8": {
        "hf_repo": "osa911/nllb-200-distilled-600M-ct2-int8",
        "directory_name": "nllb-200-distilled-600M-ct2-int8",
        "tokenizer": "facebook/nllb-200-distilled-600M",
        "display_name": "NLLB-200 Distilled 600M",
        "family": "nllb",
        "size_mb": 630,
        "quantization": "INT8",
        "license": "CC-BY-NC-4.0",
        "language_coverage": "200+ languages",
    },
    "nllb-200-distilled-1.3B-ct2-int8": {
        "hf_repo": "OpenNMT/nllb-200-distilled-1.3B-ct2-int8",
        "directory_name": "nllb-200-distilled-1.3B-ct2-int8",
        "tokenizer": "facebook/nllb-200-distilled-1.3B",
        "display_name": "NLLB-200 Distilled 1.3B",
        "family": "nllb",
        "size_mb": 1400,
        "quantization": "INT8",
        "license": "CC-BY-NC-4.0",
        "language_coverage": "200+ languages",
    },
    "nllb-200-3.3B-ct2-int8": {
        "hf_repo": "OpenNMT/nllb-200-3.3B-ct2-int8",
        "directory_name": "nllb-200-3.3B-ct2-int8",
        "tokenizer": "facebook/nllb-200-3.3B",
        "display_name": "NLLB-200 3.3B",
        "family": "nllb",
        "size_mb": 3500,
        "quantization": "INT8",
        "license": "CC-BY-NC-4.0",
        "language_coverage": "200+ languages",
    },
    "madlad400-3b-mt-ct2-int8": {
        "hf_repo": "Nextcloud-AI/madlad400-3b-mt-ct2-int8",
        "directory_name": "madlad400-3b-mt-ct2-int8",
        "tokenizer": "google/madlad400-3b-mt",
        "display_name": "MADLAD-400 3B MT",
        "family": "madlad400",
        "size_mb": 3200,
        "quantization": "INT8",
        "license": "Apache-2.0",
        "language_coverage": "190+ languages",
    },
}

# Mapping of user-friendly preset names to internal weight types
# These are the default configurations used when setting up new presets
OFFLINE_PRESETS = {
    "fast": "m2m100_418M-ct2-int8",
    "balanced": "nllb-200-distilled-600M-ct2-int8",
    "good": "nllb-200-distilled-1.3B-ct2-int8",
    "precise": "madlad400-3b-mt-ct2-int8",
}

def get_weight_preset(weight_type: str) -> str | None:
    """Return preset name for a weight type, or None if it's a custom/advanced model."""
    for preset, weight in OFFLINE_PRESETS.items():
        if weight == weight_type:
            return preset
    return None

def is_preset_weight(weight_type: str) -> bool:
    """Check if a weight type corresponds to a preset."""
    return get_weight_preset(weight_type) is not None


# These are the files shared by the CTranslate2 model repositories. Tokenizer
# assets intentionally are not listed here: M2M100 and NLLB use different
# tokenizer formats and are validated separately by checkCTranslate2Tokenizer.
_REQUIRED_CTRANSLATE2_RUNTIME_FILES = (
    "config.json",
    "model.bin",
    "shared_vocabulary.json",
)

_CTRANSLATE2_RUNTIME_PREPARED = False
_CTRANSLATE2_DLL_DIR_HANDLES = []


def _addDllDirectory(directory: str) -> None:
    if directory and os_path.isdir(directory) and hasattr(os, "add_dll_directory"):
        try:
            _CTRANSLATE2_DLL_DIR_HANDLES.append(os.add_dll_directory(directory))
        except Exception:
            pass


def _prepareCtrTranslate2Runtime() -> None:
    global _CTRANSLATE2_RUNTIME_PREPARED
    if _CTRANSLATE2_RUNTIME_PREPARED is True:
        return

    candidates = []
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root:
        candidates.extend([
            os_path.join(frozen_root, "ctranslate2"),
            os_path.join(frozen_root, "torch", "lib"),
        ])

    for package_name, relative_dir in (("ctranslate2", ""), ("torch", "lib")):
        try:
            spec = importlib.util.find_spec(package_name)
            if spec is None or spec.origin is None:
                continue
            package_dir = os_path.dirname(spec.origin)
            candidates.append(os_path.join(package_dir, relative_dir) if relative_dir else package_dir)
        except Exception:
            pass

    path_parts = os.environ.get("PATH", "").split(os.pathsep)
    for directory in candidates:
        if os_path.isdir(directory):
            _addDllDirectory(directory)
            if directory not in path_parts:
                path_parts.insert(0, directory)
    os.environ["PATH"] = os.pathsep.join(path_parts)
    _CTRANSLATE2_RUNTIME_PREPARED = True


def _getCtrTranslate2():
    _prepareCtrTranslate2Runtime()
    return importlib.import_module("ctranslate2")


def _getTransformers():
    return importlib.import_module("transformers")

def verifyCTranslate2Manifest(path: str) -> bool:
    """Verify an optional repository manifest without weakening runtime checks.

    Some CTranslate2 repositories publish exact byte counts and SHA-256 hashes
    for their converted files.  When present, validating that manifest turns a
    vague Translator-load failure into a reproducible corrupt/incomplete-file
    result.  Repositories without a manifest retain the existing runtime-file
    and CTranslate2 validation path.
    """
    manifest_path = os_path.join(path, "manifest.json")
    if not os_path.isfile(manifest_path):
        return True
    try:
        with open(manifest_path, "r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        entries = manifest.get("files")
        if not isinstance(entries, list):
            return False
        root = os_path.abspath(path)
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
                return False
            file_path = os_path.abspath(os_path.join(path, entry["name"]))
            if os_path.commonpath((root, file_path)) != root:
                return False
            if not os_path.isfile(file_path):
                return False
            expected_bytes = entry.get("bytes")
            if expected_bytes is not None and os_path.getsize(file_path) != int(expected_bytes):
                return False
            expected_sha256 = entry.get("sha256")
            if expected_sha256:
                digest = hashlib.sha256()
                with open(file_path, "rb") as model_file:
                    for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
                        digest.update(chunk)
                if digest.hexdigest().lower() != str(expected_sha256).lower():
                    return False
        return True
    except Exception:
        errorLogging()
        return False

def backwardCompatibleRenameWeightsDir(root: str):
    # 後方互換のためファイル名を変更する
    legacy_dirs = {
        "m2m100_418M": "m2m100_418M-ct2-int8",
        "m2m100_12b": "m2m100_1.2B-ct2-int8",
    }

    for weight_type_old, weight_type_new in legacy_dirs.items():
        path = os_path.join(root, "weights", "ctranslate2", weight_type_new)
        old_path = os_path.join(root, "weights", "ctranslate2", weight_type_old)
        if os_path.isdir(old_path):
            os_rename(old_path, path)

def checkCTranslate2Weight(root: str, weight_type: str = "m2m100_418M-ct2-int8"):
    weight_directory_name = ctranslate2_weights[weight_type]["directory_name"]
    path = os_path.join(root, "weights", "ctranslate2", weight_directory_name)

    if not os_path.isdir(path):
        return False
    for filename in _REQUIRED_CTRANSLATE2_RUNTIME_FILES:
        if not os_path.isfile(os_path.join(path, filename)):
            return False
    if verifyCTranslate2Manifest(path) is False:
        return False

    try:
        # モデルロード可能かどうかで判定
        compute_type = getBestComputeType("cpu", 0)
        _getCtrTranslate2().Translator(path, compute_type=compute_type)
        return True
    except Exception:
        return False

def _tokenizerCachePath(root: str, weight_type: str) -> str:
    directory_name = ctranslate2_weights[weight_type]["directory_name"]
    return os_path.join(root, "weights", "ctranslate2", directory_name, "tokenizer")

def loadCTranslate2Tokenizer(root: str, weight_type: str = "m2m100_418M-ct2-int8", local_files_only: bool = True, repair_cache: bool = False):
    tokenizer = ctranslate2_weights[weight_type]["tokenizer"]
    tokenizer_path = _tokenizerCachePath(root, weight_type)
    transformers = _getTransformers()
    if repair_cache and os_path.isdir(tokenizer_path):
        shutil.rmtree(tokenizer_path, ignore_errors=True)
    os_makedirs(tokenizer_path, exist_ok=True)
    return transformers.AutoTokenizer.from_pretrained(
        tokenizer,
        cache_dir=tokenizer_path,
        local_files_only=local_files_only,
    )

def checkCTranslate2Tokenizer(root: str, weight_type: str = "m2m100_418M-ct2-int8") -> bool:
    try:
        loadCTranslate2Tokenizer(root, weight_type, local_files_only=True)
        return True
    except Exception:
        return False

def getCTranslate2ModelReadiness(root: str, weight_type: str = "m2m100_418M-ct2-int8") -> dict:
    """Return the independent local validation results for a model.

    A CTranslate2 model is usable only when both its converted weights and its
    tokenizer cache are valid.  Keeping these checks separate gives the UI and
    activation preflight enough information to explain which explicit repair or
    download action is required.
    """
    weight_valid = checkCTranslate2Weight(root, weight_type)
    tokenizer_valid = checkCTranslate2Tokenizer(root, weight_type)
    if weight_valid and tokenizer_valid:
        stage = None
    elif not weight_valid:
        stage = "weight"
    else:
        stage = "tokenizer"
    return {
        "weight_valid": weight_valid,
        "tokenizer_valid": tokenizer_valid,
        "ready": weight_valid and tokenizer_valid,
        "stage": stage,
        "retryable": True,
    }

def downloadCTranslate2Weight(root: str, weight_type: str = "m2m100_418M-ct2-int8", callback: Callable = None, end_callback: Callable = None):
    try:
        hf_repo = ctranslate2_weights[weight_type]["hf_repo"]
    except Exception:
        errorLogging()
        return False

    if checkCTranslate2Weight(root, weight_type):
        return True

    try:
        files = list_repo_files(repo_id=hf_repo)
    except Exception:
        errorLogging()
        return False

    path = os_path.join(root, "weights", "ctranslate2", ctranslate2_weights[weight_type]["directory_name"])
    os_makedirs(path, exist_ok=True)

    def downloadFile(url: str, file_path: str, func: Callable = None):
        temp_path = f"{file_path}.part"
        try:
            os_makedirs(os_path.dirname(file_path), exist_ok=True)
            with requests_get(url, stream=True, timeout=(10, 120)) as res:
                res.raise_for_status()
                file_size = int(res.headers.get('content-length', 0))
                total_chunk = 0
                with open(temp_path, 'wb') as file:
                    for chunk in res.iter_content(chunk_size=1024 * 2000):
                        if not chunk:
                            continue
                        file.write(chunk)
                        total_chunk += len(chunk)
                        if func is not None and file_size:
                            func(total_chunk / file_size)

                if file_size and total_chunk < file_size:
                    raise IOError(f"Incomplete download for {file_path}: {total_chunk}/{file_size}")

            os_replace(temp_path, file_path)
            return True
        except Exception:
            errorLogging()
            for broken_path in (temp_path, file_path):
                try:
                    if os_path.exists(broken_path):
                        os_remove(broken_path)
                except Exception:
                    pass
            return False

    download_succeeded = True
    for filename in files:
        file_path = os_path.join(path, filename)
        url = hf_hub_url(hf_repo, filename)
        if downloadFile(url, file_path, func=callback if filename == "model.bin" else None) is False:
            download_succeeded = False
            break

    if end_callback is not None:
        end_callback()

    if download_succeeded is False:
        return False

    if verifyCTranslate2Manifest(path) is False:
        return False

    return checkCTranslate2Weight(root, weight_type)

def downloadCTranslate2Tokenizer(path: str, weight_type: str = "m2m100_418M-ct2-int8"):
    if checkCTranslate2Tokenizer(path, weight_type):
        return True
    try:
        loadCTranslate2Tokenizer(path, weight_type, local_files_only=False, repair_cache=True)
        return checkCTranslate2Tokenizer(path, weight_type)
    except Exception:
        errorLogging()
        return False

def loadTranslatePromptConfig(root_path: str | None = None, prompt_filename: str | None = None) -> dict:
    # PyInstaller 展開後
    if root_path and prompt_filename and os_path.exists(os_path.join(root_path, "_internal", "translation_settings", "prompt", prompt_filename)):
        prompt_path = os_path.join(root_path, "_internal", "translation_settings", "prompt", prompt_filename)
    # src-python 直下実行
    elif prompt_filename and os_path.exists(os_path.join(os_path.dirname(__file__), "models", "translation", "translation_settings", "prompt", prompt_filename)):
        prompt_path = os_path.join(os_path.dirname(__file__), "models", "translation", "translation_settings", "prompt", prompt_filename)
    # translation フォルダ直下実行
    elif prompt_filename and os_path.exists(os_path.join(os_path.dirname(__file__), "translation_settings", "prompt", prompt_filename)):
        prompt_path = os_path.join(os_path.dirname(__file__), "translation_settings", "prompt", prompt_filename)
    else:
        raise FileNotFoundError(f"Prompt file not found: {prompt_filename}")
    with open(prompt_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

# テスト用コード（直接実行時のみ）
if __name__ == "__main__":
    def progress_callback(percent):
        print(f"Download progress: {percent*100:.2f}%")

    def end_callback():
        print("Download finished.")

    root = "./"  # 必要に応じてパスを変更
    # for weight_type in ctranslate2_weights.keys():
    #     print(f"Testing download for: {weight_type}")
    #     downloadCTranslate2Weight(root, weight_type, callback=progress_callback, end_callback=end_callback)
    #     result = checkCTranslate2Weight(root, weight_type)
    #     print(f"Model loadable: {result}")
    #     break
    # downloadCTranslate2Tokenizer(root, "m2m100_418M-ct2-int8")

    # model download test
    downloadCTranslate2Weight(root, "nllb-200-distilled-1.3B", callback=progress_callback, end_callback=end_callback)
    result = checkCTranslate2Weight(root, "nllb-200-distilled-1.3B")
    print(f"Model loadable: {result}")
