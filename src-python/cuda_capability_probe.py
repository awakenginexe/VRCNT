"""Offline, model-free CUDA capability probe for the staged backend."""

from __future__ import annotations

import importlib
import json
from typing import Optional, Tuple


ProbeResult = Tuple[bool, bool, Optional[str], Optional[str]]


def probe_local_cuda_backend() -> ProbeResult:
    """Load only the packaged CUDA runtime and perform a trivial local allocation."""
    try:
        torch = importlib.import_module("torch")
    except Exception:
        return False, True, "cuda_dependency_unavailable", "The packaged CUDA dependencies are unavailable."

    try:
        if not torch.cuda.is_available() or torch.cuda.device_count() < 1:
            return False, True, "cuda_unavailable", "No compatible local CUDA device is available."
        torch.empty(1, device="cuda")
        torch.cuda.synchronize()
    except Exception:
        return False, True, "cuda_backend_unavailable", "The packaged CUDA backend could not initialize a local CUDA device."

    return True, True, None, None


def run_cuda_capability_probe(offline: bool = True) -> int:
    if not offline:
        result: ProbeResult = (False, True, "cuda_probe_invalid_request", "The CUDA capability probe requires offline mode.")
    else:
        result = probe_local_cuda_backend()
    supported, conclusive, failure_code, detail = result
    print(json.dumps({
        "supported": supported,
        "conclusive": conclusive,
        "failureCode": failure_code,
        "detail": detail,
    }, separators=(",", ":")), flush=True)
    return 0
