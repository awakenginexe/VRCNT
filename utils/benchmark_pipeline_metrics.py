"""Summarize opt-in VRCNT numeric pipeline metrics; optionally sample resources.

Record: set VRCNT_BENCHMARK_METRICS_PATH before launching VRCNT. Run each
scenario with a separate file. Do not store transcripts, audio, or API keys.
"""

import argparse
import csv
import json
import math
import subprocess
import time
from pathlib import Path


def percentile(values, percent):
    values = sorted(float(value) for value in values)
    if not values:
        return None
    index = (len(values) - 1) * percent / 100
    lower = math.floor(index)
    upper = math.ceil(index)
    return round(values[lower] + (values[upper] - values[lower]) * (index - lower), 2)


def distribution(values):
    return {"count": len(values), "p50": percentile(values, 50), "p95": percentile(values, 95)}


def read_jsonl(path):
    with Path(path).open(encoding="utf-8") as source:
        for line in source:
            if line.strip():
                item = json.loads(line)
                if isinstance(item, dict):
                    yield item


def summarize(events, scenario, resources=(), frame_times=()):
    events = list(events)
    resources = list(resources)
    frame_times = list(frame_times)

    def values(stage, field, outcomes=None):
        return [
            item[field] for item in events
            if item.get("stage") == stage
            and (outcomes is None or item.get("outcome") in outcomes)
            and type(item.get(field)) in (int, float)
        ]

    output = [item for item in events if item.get("stage") == "output" and item.get("outcome") == "success"]
    failures = [item for item in events if item.get("outcome") in ("error", "timeout")]
    overloads = [item for item in events if item.get("outcome") == "skipped_overload"]
    cancellations = [
        item for item in events
        if item.get("outcome") == "cancelled"
        or item.get("error_code") in (
            "audio_queue_cancelled", "transcription_generation_retired"
        )
    ]
    dropped_by_source = {}
    for item in events:
        source = item.get("source")
        count = item.get("dropped_count")
        if source in ("mic", "speaker") and type(count) is int:
            dropped_by_source[source] = max(count, dropped_by_source.get(source, 0))
    return {
        "scenario": scenario,
        "metric_events": len(events),
        "completed_outputs": len(output),
        "speech_end_to_final_ms": distribution([
            item["speech_to_output_ms"] for item in output
            if type(item.get("speech_to_output_ms")) in (int, float)
        ]),
        "queue_wait_ms": {
            stage: distribution(values(stage, "queue_age_ms", ("sending",) if stage == "translation" else ("success",)))
            for stage in ("queue", "translation")
        },
        "inference_ms": {
            stage: distribution(values(stage, "duration_ms", ("success",)))
            for stage in ("transcription", "translation")
        },
        "failure_count": len(failures),
        "overload_count": len(overloads),
        "cancelled_count": len(cancellations),
        "dropped_count_by_source": dropped_by_source,
        "audio_input_trimmed_ms": sum(values("audio_input", "audio_trimmed_ms")),
        "audio_buffer_trimmed_ms": sum(values("audio_buffer", "audio_trimmed_ms")),
        "peak_system_ram_used_mb": max((item["ram_used_mb"] for item in resources if type(item.get("ram_used_mb")) in (int, float)), default=None),
        "peak_gpu_total_used_mb": max((item["gpu_total_used_mb"] for item in resources if type(item.get("gpu_total_used_mb")) in (int, float)), default=None),
        "vrchat_frame_time_ms": distribution(frame_times),
        "quality": None,
    }


def sample_resources(path, duration, interval):
    import psutil

    deadline = time.monotonic() + duration
    with Path(path).open("a", encoding="utf-8") as destination:
        while time.monotonic() < deadline:
            gpu_total_used_mb = None
            try:
                process = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=2, check=True,
                )
                gpu_total_used_mb = float(process.stdout.splitlines()[0].strip())
            except (OSError, ValueError, IndexError, subprocess.SubprocessError):
                pass
            destination.write(json.dumps({
                "ram_used_mb": round(psutil.virtual_memory().used / (1024 * 1024), 2),
                "gpu_total_used_mb": gpu_total_used_mb,
            }) + "\n")
            destination.flush()
            time.sleep(max(0.1, interval))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sample = commands.add_parser("sample")
    sample.add_argument("--resources", required=True)
    sample.add_argument("--seconds", type=float, required=True)
    sample.add_argument("--interval", type=float, default=0.5)
    report = commands.add_parser("report")
    report.add_argument("--events", required=True)
    report.add_argument("--scenario", required=True)
    report.add_argument("--resources")
    report.add_argument("--vrchat-frames", help="CSV with a frame_time_ms column from a real frame timing tool")
    report.add_argument("--out")
    args = parser.parse_args()
    if args.command == "sample":
        sample_resources(args.resources, args.seconds, args.interval)
        return
    frames = []
    if args.vrchat_frames:
        with Path(args.vrchat_frames).open(encoding="utf-8-sig", newline="") as source:
            frames = [float(row["frame_time_ms"]) for row in csv.DictReader(source)]
    result = summarize(
        read_jsonl(args.events), args.scenario,
        read_jsonl(args.resources) if args.resources else (), frames,
    )
    encoded = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
