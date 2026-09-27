"""Parakeet provider and inference error classification."""

import os
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from models.transcription import transcription_parakeet as parakeet


class Session:
    def __init__(self, providers):
        self.providers = providers

    def get_providers(self):
        return self.providers


def adapter(providers, recognize=lambda *_args, **_kwargs: "hello"):
    asr = types.SimpleNamespace(
        _encoder=Session(providers), _decoder_joint=Session(providers)
    )
    return types.SimpleNamespace(asr=asr, recognize=recognize)


class ParakeetRuntimeDiagnosticsTests(unittest.TestCase):
    def test_cuda_and_cpu_providers_mean_cuda_is_attached(self):
        runtime = adapter(["CUDAExecutionProvider", "CPUExecutionProvider"])
        with patch.object(parakeet.onnx_asr, "load_model", return_value=runtime):
            recognizer = parakeet.ParakeetRecognizer("model", device="cuda")
        self.assertEqual(recognizer.requested_device, "cuda")
        self.assertEqual(recognizer.provider_status, "cuda_attached")

    def test_cpu_only_core_session_is_reported_as_fallback(self):
        runtime = adapter(["CPUExecutionProvider"])
        with patch.object(parakeet.onnx_asr, "load_model", return_value=runtime):
            with self.assertRaisesRegex(RuntimeError, "CPU fallback"):
                parakeet.ParakeetRecognizer("model", device="cuda")

    def test_cuda_initialization_failure_is_not_called_oom(self):
        with patch.object(parakeet, "checkParakeetWeight", return_value=True), patch.object(
            parakeet.onnx_asr, "load_model", side_effect=RuntimeError("CUDA DLL not found")
        ):
            with self.assertRaises(RuntimeError) as raised:
                parakeet.getParakeetModel("root", "parakeet-tdt-0.6b-v3")
        self.assertNotEqual(str(raised.exception), "VRAM_OUT_OF_MEMORY")

    def test_actual_cuda_allocation_failure_is_oom(self):
        with patch.object(parakeet, "checkParakeetWeight", return_value=True), patch.object(
            parakeet.onnx_asr, "load_model", side_effect=RuntimeError("CUDA out of memory")
        ):
            with self.assertRaises(ValueError) as raised:
                parakeet.getParakeetModel("root", "parakeet-tdt-0.6b-v3")
        self.assertEqual(raised.exception.args[0], "VRAM_OUT_OF_MEMORY")

    def test_inference_exception_is_not_silent_no_speech(self):
        runtime = adapter(["CPUExecutionProvider"], recognize=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("inference failed")))
        with patch.object(parakeet.onnx_asr, "load_model", return_value=runtime):
            recognizer = parakeet.ParakeetRecognizer("model", device="cpu")
        with self.assertRaisesRegex(RuntimeError, "inference failed"):
            recognizer.transcribe(np.zeros(160, dtype=np.float32))


if __name__ == "__main__":
    unittest.main()
