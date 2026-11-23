from __future__ import annotations

import csv
import ctypes
import subprocess
from io import StringIO
from typing import Any

import psutil


def clamp_percent(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(100.0, number)), 1)


def _metric(available: bool, percent: float | None) -> dict:
    return {
        "available": available,
        "percent": clamp_percent(percent) if percent is not None else None,
    }


_nvml = None  # None: not tried yet, False: unavailable


class _NvmlUtilization(ctypes.Structure):
    _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]


class _NvmlMemory(ctypes.Structure):
    _fields_ = [
        ("total", ctypes.c_ulonglong),
        ("free", ctypes.c_ulonglong),
        ("used", ctypes.c_ulonglong),
    ]


def _nvml_rows() -> list[dict] | None:
    """Read GPU usage from the NVIDIA driver library already loaded in-process.

    Starting nvidia-smi takes about a second per poll and wakes the driver each
    time, which competes with a running game. NVML answers in microseconds.
    """
    global _nvml
    if _nvml is None:
        try:
            library = ctypes.CDLL("nvml.dll")
            _nvml = library if library.nvmlInit_v2() == 0 else False
        except Exception:
            _nvml = False
    if not _nvml:
        return None

    count = ctypes.c_uint()
    if _nvml.nvmlDeviceGetCount_v2(ctypes.byref(count)) != 0:
        return None
    rows = []
    for index in range(count.value):
        handle = ctypes.c_void_p()
        name = ctypes.create_string_buffer(96)
        utilization = _NvmlUtilization()
        memory = _NvmlMemory()
        if (
            _nvml.nvmlDeviceGetHandleByIndex_v2(index, ctypes.byref(handle))
            or _nvml.nvmlDeviceGetName(handle, name, len(name))
            or _nvml.nvmlDeviceGetUtilizationRates(handle, ctypes.byref(utilization))
            or _nvml.nvmlDeviceGetMemoryInfo(handle, ctypes.byref(memory))
        ):
            continue
        rows.append(
            {
                "device_index": index,
                "device_name": name.value.decode("utf-8", "replace"),
                "gpu_percent": clamp_percent(utilization.gpu),
                "memory_used": float(memory.used),
                "memory_total": float(memory.total),
            }
        )
    return rows or None


def gpu_device_names() -> list[str]:
    """NVIDIA GPU names in driver order; empty when NVML is unavailable."""
    return [row["device_name"] for row in _nvml_rows() or []]


def _nvidia_smi_rows() -> list[dict] | None:
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
    except Exception:
        return None

    rows = list(csv.reader(StringIO(completed.stdout.strip())))
    if not rows:
        return None

    parsed_rows = []
    for row in rows:
        try:
            parsed_rows.append(
                {
                    "device_index": int(str(row[0]).strip()),
                    "device_name": str(row[1]).strip(),
                    "gpu_percent": clamp_percent(row[2]),
                    "memory_used": float(row[3]),
                    "memory_total": float(row[4]),
                }
            )
        except (IndexError, TypeError, ValueError):
            continue

    return parsed_rows or None


def _query_gpu(selected_gpu_index: int | None = None) -> dict | None:
    parsed_rows = _nvml_rows() or _nvidia_smi_rows()
    if not parsed_rows:
        return None

    selected_row = next(
        (row for row in parsed_rows if row["device_index"] == selected_gpu_index),
        parsed_rows[0],
    )

    vram_percent = None
    if selected_row["memory_total"] > 0:
        vram_percent = clamp_percent((selected_row["memory_used"] / selected_row["memory_total"]) * 100)

    return {
        "gpu": _metric(True, selected_row["gpu_percent"]),
        "vram": _metric(vram_percent is not None, vram_percent),
        "gpu_devices": [
            {
                "device_index": row["device_index"],
                "device_name": row["device_name"],
            }
            for row in parsed_rows
        ],
        "selected_gpu_index": selected_row["device_index"],
    }


def collect_resource_usage(selected_gpu_index: int | None = None) -> dict:
    gpu = _query_gpu(selected_gpu_index)
    return {
        "cpu": _metric(True, psutil.cpu_percent(interval=None)),
        "ram": _metric(True, psutil.virtual_memory().percent),
        "gpu": gpu["gpu"] if gpu else _metric(False, None),
        "vram": gpu["vram"] if gpu else _metric(False, None),
        "gpu_devices": gpu["gpu_devices"] if gpu else [],
        "selected_gpu_index": gpu["selected_gpu_index"] if gpu else None,
    }
