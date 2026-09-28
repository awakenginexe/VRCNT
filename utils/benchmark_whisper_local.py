"""Measure a local Whisper CUDA model with an explicit WAV speech sample.

Run once per compute type in a fresh process. Output contains numeric results
only; neither input audio nor decoded transcript is written to diagnostics.
"""

import argparse
import json
import subprocess
import sys
import threading
import time
import wave
import gc
from pathlib import Path

import numpy as np
import psutil

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src-python"))

import ctranslate2
import faster_whisper
from config import config
from models.transcription.transcription_whisper import checkWhisperWeight, unloadWhisperModel
from benchmark_pipeline_metrics import distribution


def gpu_used_mb(index):
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=2, check=True,
        )
        return float(result.stdout.splitlines()[index].strip())
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def vrchat_running():
    """Record process presence only; do not inspect VRChat or its contents."""
    try:
        return any(
            (process.info.get("name") or "").lower() == "vrchat.exe"
            for process in psutil.process_iter(attrs=["name"])
        )
    except (OSError, psutil.Error):
        return None


class ResourceSampler:
    def __init__(self, gpu_index, interval):
        self.gpu_index = gpu_index
        self.interval = interval
        self.process = psutil.Process()
        self.stop = threading.Event()
        self.ram = []
        self.gpu = []
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def sample(self):
        ram = self.process.memory_info().rss / 1024**2
        gpu = gpu_used_mb(self.gpu_index)
        with self.lock:
            self.ram.append(ram)
            if gpu is not None:
                self.gpu.append(gpu)
        return ram, gpu

    def _run(self):
        while not self.stop.is_set():
            self.sample()
            self.stop.wait(self.interval)

    def start(self):
        self.thread.start()

    def close(self):
        self.stop.set()
        self.thread.join()
        self.sample()


def read_wav(path):
    started = time.perf_counter()
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16000):
            raise ValueError("WAV must be mono PCM16 at 16000 Hz")
        raw = source.readframes(source.getnframes())
    audio = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    if not audio.size:
        raise ValueError("WAV is empty")
    return audio, (time.perf_counter() - started) * 1000


def word_error_rate(expected, actual):
    left = expected.casefold().split()
    right = actual.casefold().split()
    if not left:
        return None
    previous = list(range(len(right) + 1))
    for index, expected_word in enumerate(left, 1):
        current = [index]
        for target_index, actual_word in enumerate(right, 1):
            current.append(min(
                previous[target_index] + 1,
                current[target_index - 1] + 1,
                previous[target_index - 1] + (expected_word != actual_word),
            ))
        previous = current
    return round(previous[-1] / len(left), 4)


def benchmark(args):
    model_path = Path(config.PATH_DATA) / "weights" / "whisper" / args.model
    if not checkWhisperWeight(config.PATH_DATA, args.model):
        raise FileNotFoundError("selected Whisper model is not complete locally")
    supported = ctranslate2.get_supported_compute_types("cuda", args.gpu_index)
    if args.compute_type not in supported:
        raise ValueError("requested CUDA compute type is unsupported on this device")
    audio, preprocessing_ms = read_wav(args.wav)
    sampler = ResourceSampler(args.gpu_index, args.sample_interval)
    baseline_gpu = gpu_used_mb(args.gpu_index)
    baseline_ram = sampler.process.memory_info().rss / 1024**2
    vrchat_at_start = vrchat_running()
    sampler.start()
    load_started = time.perf_counter()
    model = None
    try:
        model = faster_whisper.WhisperModel(
            str(model_path), device="cuda", device_index=args.gpu_index,
            compute_type=args.compute_type, cpu_threads=4, num_workers=1,
            local_files_only=True,
        )
        load_ms = (time.perf_counter() - load_started) * 1000
        after_load_ram, after_load_gpu = sampler.sample()
        languages = tuple(code.strip() for code in args.languages.split(",") if code.strip())
        if not languages:
            raise ValueError("at least one language code is required")
        detection_times = []
        inference_times = []
        decoded = ""
        for iteration in range(args.iterations + 1):
            selected = languages[0]
            if len(languages) > 1:
                detection_started = time.perf_counter()
                _, _, probabilities = model.detect_language(audio, vad_filter=True)
                by_code = dict(probabilities)
                candidates = [(code, by_code[code]) for code in languages if code in by_code]
                if not candidates:
                    raise RuntimeError("model omitted every configured language")
                selected = max(candidates, key=lambda item: item[1])[0]
                detection_ms = (time.perf_counter() - detection_started) * 1000
            else:
                detection_ms = 0.0
            inference_started = time.perf_counter()
            segments, _info = model.transcribe(
                audio, language=selected, beam_size=args.beam_size,
                temperature=0.0, vad_filter=True, without_timestamps=True,
                word_timestamps=False, task="transcribe",
            )
            decoded = " ".join(segment.text.strip() for segment in segments).strip()
            inference_ms = (time.perf_counter() - inference_started) * 1000
            if iteration == 0:
                after_warmup_ram, after_warmup_gpu = sampler.sample()
            else:
                detection_times.append(detection_ms)
                inference_times.append(inference_ms)
        sampler.sample()
        expected = Path(args.reference).read_text(encoding="utf-8") if args.reference else None
        return {
            "model": args.model,
            "compute_type": args.compute_type,
            "ctranslate2_version": ctranslate2.__version__,
            "faster_whisper_version": faster_whisper.__version__,
            "sample_duration_seconds": round(len(audio) / 16000, 3),
            "iterations": args.iterations,
            "preprocessing_ms": round(preprocessing_ms, 2),
            "load_ms": round(load_ms, 2),
            "detection_ms": distribution(detection_times),
            "inference_ms": distribution(inference_times),
            "word_error_rate": word_error_rate(expected, decoded) if expected is not None else None,
            "baseline_process_ram_mb": round(baseline_ram, 2),
            "after_load_process_ram_mb": round(after_load_ram, 2),
            "after_warmup_process_ram_mb": round(after_warmup_ram, 2),
            "peak_sampled_process_ram_mb": round(max(sampler.ram), 2),
            "baseline_gpu_total_used_mb": baseline_gpu,
            "vrchat_process_running_at_start": vrchat_at_start,
            "vrchat_process_running_at_end": vrchat_running(),
            "after_load_gpu_total_used_mb": after_load_gpu,
            "after_warmup_gpu_total_used_mb": after_warmup_gpu,
            "peak_sampled_gpu_total_used_mb": max(sampler.gpu) if sampler.gpu else None,
            "note": "GPU memory is system-wide sampled usage; results exclude VRChat frame timing",
        }
    finally:
        sampler.close()
        if model is not None:
            unloadWhisperModel(model)
            del model
            gc.collect()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--compute-type", choices=("int8_float16", "float16"), required=True)
    parser.add_argument("--gpu-index", type=int, default=0)
    parser.add_argument("--beam-size", type=int, default=2)
    parser.add_argument("--languages", default="en")
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--sample-interval", type=float, default=0.2)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.iterations < 1 or args.beam_size < 1 or args.sample_interval <= 0 or args.gpu_index < 0:
        parser.error("iterations, beam size and sample interval must be positive; GPU index must be nonnegative")
    result = benchmark(args)
    encoded = json.dumps(result, indent=2)
    if args.out:
        args.out.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
