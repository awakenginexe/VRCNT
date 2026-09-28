"""Benchmark local translation alone or Whisper plus translation in one process.

Input speech/text remains local and is never included in the numeric result.
This direct model benchmark excludes the app's audio and translation queues.
"""

import argparse
import gc
import json
import sys
import time
from pathlib import Path

import ctranslate2
import faster_whisper

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src-python"))

from config import config
from models.translation.translation_translator import Translator
from models.translation.translation_utils import ctranslate2_weights
from models.transcription.transcription_whisper import checkWhisperWeight, unloadWhisperModel
from benchmark_pipeline_metrics import distribution
from benchmark_whisper_local import ResourceSampler, gpu_used_mb, read_wav, vrchat_running


def benchmark(args):
    if args.mode == "translation" and args.text is None:
        raise ValueError("--text is required for translation mode")
    if args.mode == "combined" and args.wav is None:
        raise ValueError("--wav is required for combined mode")
    if args.translation_model not in ctranslate2_weights:
        raise ValueError("unknown local translation model")
    translation_dir = Path(config.PATH_DATA) / "weights" / "ctranslate2" / ctranslate2_weights[args.translation_model]["directory_name"]
    if not all((translation_dir / name).is_file() for name in ("config.json", "model.bin", "shared_vocabulary.json")):
        raise FileNotFoundError("selected local translation weights are unavailable")
    if args.mode == "combined" and not checkWhisperWeight(config.PATH_DATA, args.whisper_model):
        raise FileNotFoundError("selected Whisper model is not complete locally")
    if args.compute_type not in ctranslate2.get_supported_compute_types("cuda", args.gpu_index):
        raise ValueError("requested CUDA compute type is unsupported on this device")
    source_text = args.text.read_text(encoding="utf-8").strip() if args.text else None
    if args.mode == "translation" and not source_text:
        raise ValueError("--text must contain nonempty input")
    audio, preprocessing_ms = read_wav(args.wav) if args.wav else (None, None)
    sampler = ResourceSampler(args.gpu_index, args.sample_interval)
    baseline_gpu = gpu_used_mb(args.gpu_index)
    baseline_ram = sampler.process.memory_info().rss / 1024**2
    vrchat_at_start = vrchat_running()
    sampler.start()
    translator = Translator()
    whisper = None
    report = None
    try:
        load_started = time.perf_counter()
        translator.changeCTranslate2Model(
            config.PATH_DATA, args.translation_model,
            device="cuda", device_index=args.gpu_index,
            compute_type=args.compute_type,
        )
        translation_load_ms = (time.perf_counter() - load_started) * 1000
        translator.setLocalDecodingOptions(args.profile, args.custom_beam_size)
        if args.mode == "combined":
            whisper_load_started = time.perf_counter()
            whisper = faster_whisper.WhisperModel(
                str(Path(config.PATH_DATA) / "weights" / "whisper" / args.whisper_model),
                device="cuda", device_index=args.gpu_index,
                compute_type=args.compute_type, cpu_threads=4, num_workers=1,
                local_files_only=True,
            )
            whisper_load_ms = (time.perf_counter() - whisper_load_started) * 1000
        else:
            whisper_load_ms = None
        load_ms = (time.perf_counter() - load_started) * 1000
        after_load_ram, after_load_gpu = sampler.sample()
        transcription_times = []
        translation_times = []
        end_to_end_times = []
        warmup_ms = None
        warmup_outcome = None
        no_speech = 0
        translation_failures = 0
        for iteration in range(args.iterations + 1):
            iteration_started = time.perf_counter()
            text = source_text
            if whisper is not None:
                started = time.perf_counter()
                segments, _info = whisper.transcribe(
                    audio, language=args.whisper_language,
                    beam_size=args.whisper_beam_size, temperature=0.0,
                    vad_filter=True, without_timestamps=True,
                    word_timestamps=False, task="transcribe",
                )
                text = " ".join(segment.text.strip() for segment in segments).strip()
                transcription_ms = (time.perf_counter() - started) * 1000
            else:
                transcription_ms = None
            started = time.perf_counter()
            translated = translator.translateCTranslate2(
                text or "", args.source_language,
                args.target_language, args.translation_model,
            ) if text else False
            translation_ms = (time.perf_counter() - started) * 1000
            elapsed_ms = (time.perf_counter() - iteration_started) * 1000
            outcome = "no_speech" if not text else "translation_failure" if not translated else "success"
            if iteration == 0:
                warmup_ms = elapsed_ms
                warmup_outcome = outcome
                after_warmup_ram, after_warmup_gpu = sampler.sample()
            else:
                if outcome == "no_speech":
                    no_speech += 1
                elif outcome == "translation_failure":
                    translation_failures += 1
                if transcription_ms is not None:
                    transcription_times.append(transcription_ms)
                if text:
                    translation_times.append(translation_ms)
                end_to_end_times.append(elapsed_ms)
        sampler.sample()
        report = {
            "mode": args.mode,
            "whisper_model": args.whisper_model if whisper is not None else None,
            "translation_model": args.translation_model,
            "compute_type": args.compute_type,
            "translation_profile": args.profile,
            "custom_beam_size": args.custom_beam_size,
            "iterations": args.iterations,
            "preprocessing_ms": round(preprocessing_ms, 2) if preprocessing_ms is not None else None,
            "translation_load_ms": round(translation_load_ms, 2),
            "whisper_load_ms": round(whisper_load_ms, 2) if whisper_load_ms is not None else None,
            "load_ms": round(load_ms, 2),
            "warmup_ms": round(warmup_ms, 2),
            "warmup_outcome": warmup_outcome,
            "transcription_ms": distribution(transcription_times),
            "translation_ms": distribution(translation_times),
            "end_to_end_local_ms": distribution(end_to_end_times),
            "no_speech_count": no_speech,
            "translation_failure_count": translation_failures,
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
            "quality": None,
            "note": "Direct local model benchmark; no live queues, VRChat frame timing, or translation reference score; GPU memory is system-wide sampled usage",
        }
    finally:
        try:
            translator.unloadCTranslate2Model()
        finally:
            try:
                if whisper is not None:
                    unloadWhisperModel(whisper)
                    del whisper
            finally:
                gc.collect()
                after_release_ram, after_release_gpu = sampler.sample()
                sampler.close()
                if report is not None:
                    report["after_release_process_ram_mb"] = round(after_release_ram, 2)
                    report["after_release_gpu_total_used_mb"] = after_release_gpu
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("translation", "combined"))
    parser.add_argument("--text", type=Path)
    parser.add_argument("--wav", type=Path)
    parser.add_argument("--translation-model", default="m2m100_418M-ct2-int8")
    parser.add_argument("--whisper-model", default="tiny")
    parser.add_argument("--source-language", default="en")
    parser.add_argument("--target-language", default="ja")
    parser.add_argument("--whisper-language", default="en")
    parser.add_argument("--compute-type", default="int8_float16")
    parser.add_argument("--profile", choices=("economy", "balanced"), default="balanced")
    parser.add_argument("--custom-beam-size", type=int, default=0)
    parser.add_argument("--whisper-beam-size", type=int, default=2)
    parser.add_argument("--gpu-index", type=int, default=0)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--sample-interval", type=float, default=0.2)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if (args.iterations < 1 or args.whisper_beam_size < 1 or args.sample_interval <= 0
            or args.gpu_index < 0 or not 0 <= args.custom_beam_size <= 16):
        parser.error("iterations, Whisper beam and sample interval must be positive; GPU index must be nonnegative; custom beam must be 0..16")
    try:
        result = benchmark(args)
    except (ValueError, FileNotFoundError) as error:
        parser.error(str(error))
    encoded = json.dumps(result, indent=2)
    if args.out:
        args.out.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
