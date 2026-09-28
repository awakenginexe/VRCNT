"""Expose the CUDA 12 libraries used by CTranslate2 beside CUDA 13 Torch."""

import importlib.util
import os
import sys
from pathlib import Path
from threading import Lock


_LOCK = Lock()
_DLL_DIR_HANDLES = []
_REGISTERED_PATHS = set()


def prepare_cuda12_runtime() -> None:
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root:
        root = Path(frozen_root)
    else:
        torch_spec = importlib.util.find_spec("torch")
        if torch_spec is None or torch_spec.origin is None:
            return
        root = Path(torch_spec.origin).parent.parent

    with _LOCK:
        path_parts = os.environ.get("PATH", "").split(os.pathsep)
        for package in ("cublas", "cuda_runtime", "cufft"):
            directory = str(root / "nvidia" / package / "bin")
            if not os.path.isdir(directory):
                continue
            if directory not in _REGISTERED_PATHS:
                if hasattr(os, "add_dll_directory"):
                    try:
                        _DLL_DIR_HANDLES.append(os.add_dll_directory(directory))
                    except OSError:
                        pass  # Explicit CUDA library loads also search PATH.
                _REGISTERED_PATHS.add(directory)
            if directory not in path_parts:
                path_parts.insert(0, directory)
        os.environ["PATH"] = os.pathsep.join(path_parts)
