"""Explicitly enabled, numeric-only pipeline benchmark recording."""

import json
import os
import re
from threading import Lock


BENCHMARK_METRICS_ENV = "VRCNT_BENCHMARK_METRICS_PATH"
_write_lock = Lock()
_NUMERIC_FIELDS = (
    "queue_age_ms", "duration_ms", "queue_depth", "dropped_count",
    "observed_at_ms", "audio_trimmed_ms", "speech_to_output_ms",
)
_CATEGORY_FIELDS = ("source", "stage", "engine", "outcome", "error_code")


def record_pipeline_benchmark_metric(event) -> None:
    path = os.environ.get(BENCHMARK_METRICS_ENV)
    if not path:
        return
    payload = event.to_payload()
    safe = {
        key: value for key in _NUMERIC_FIELDS
        if (value := payload.get(key)) is None or type(value) in (int, float)
    }
    for key in _CATEGORY_FIELDS:
        value = payload.get(key)
        if value is None or (isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", value)):
            safe[key] = value
    try:
        with _write_lock, open(path, "a", encoding="utf-8") as output:
            output.write(json.dumps(safe, separators=(",", ":")) + "\n")
    except OSError:
        # A benchmark recorder must not interrupt real-time capture or output.
        pass
