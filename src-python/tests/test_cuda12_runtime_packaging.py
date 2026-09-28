import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src-python"))
sys.path.insert(0, str(ROOT / "spec"))


class Cuda12RuntimePackagingTests(unittest.TestCase):
    def test_cuda_build_bundles_separate_cuda12_libraries(self):
        from backend_common import backend_analysis_configuration

        environment = ROOT / ".venv_cuda"
        cuda = backend_analysis_configuration("cuda", ROOT, environment)
        cpu = backend_analysis_configuration("cpu", ROOT, environment)
        cuda_datas = dict(cuda["environment_datas"])
        cpu_datas = dict(cpu["environment_datas"])
        for package in ("cublas", "cuda_runtime", "cufft"):
            source = str(environment / "Lib" / "site-packages" / "nvidia" / package)
            self.assertEqual(f"nvidia/{package}/", cuda_datas[source])
            self.assertNotIn(source, cpu_datas)

    def test_translation_and_sensevoice_find_frozen_cuda12_libraries(self):
        import cuda12_runtime
        from models.translation import translation_utils
        from models.transcription import transcription_sensevoice

        with tempfile.TemporaryDirectory() as root:
            frozen_root = Path(root)
            paths = [
                frozen_root / "nvidia" / "cublas" / "bin",
                frozen_root / "nvidia" / "cuda_runtime" / "bin",
                frozen_root / "nvidia" / "cufft" / "bin",
            ]
            for path in paths:
                path.mkdir(parents=True)
            with (
                mock.patch.object(sys, "_MEIPASS", str(frozen_root), create=True),
                mock.patch.dict(os.environ, {"PATH": ""}),
                mock.patch.object(os, "add_dll_directory", create=True),
                mock.patch.object(translation_utils, "_CTRANSLATE2_RUNTIME_PREPARED", False),
                mock.patch.object(translation_utils, "_CTRANSLATE2_DLL_DIR_HANDLES", []),
                mock.patch.object(transcription_sensevoice, "_DLL_DIR_HANDLES", []),
                mock.patch.object(cuda12_runtime, "_REGISTERED_PATHS", set()),
                mock.patch.object(cuda12_runtime, "_DLL_DIR_HANDLES", []),
            ):
                translation_utils._prepareCtrTranslate2Runtime()
                self.assertTrue(all(str(path) in os.environ["PATH"].split(os.pathsep) for path in paths))
                os.environ["PATH"] = ""
                transcription_sensevoice._addCudaDllDirectories()
                self.assertTrue(all(str(path) in os.environ["PATH"].split(os.pathsep) for path in paths))

    def test_whisper_prepares_cuda12_libraries_before_importing_native_model(self):
        from models.transcription import transcription_whisper

        calls = mock.Mock()
        with (
            mock.patch.object(transcription_whisper, "prepare_cuda12_runtime", calls.prepare, create=True),
            mock.patch.object(transcription_whisper.importlib, "import_module", calls.import_module),
        ):
            transcription_whisper._getWhisperModelClass()
        self.assertEqual([mock.call.prepare(), mock.call.import_module("faster_whisper")], calls.mock_calls)

    def test_cuda12_search_paths_remain_available_when_dll_registration_fails(self):
        import cuda12_runtime

        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "nvidia" / "cublas" / "bin"
            directory.mkdir(parents=True)
            with (
                mock.patch.object(sys, "_MEIPASS", root, create=True),
                mock.patch.dict(os.environ, {"PATH": ""}),
                mock.patch.object(os, "add_dll_directory", side_effect=OSError("unavailable"), create=True),
                mock.patch.object(cuda12_runtime, "_REGISTERED_PATHS", set()),
                mock.patch.object(cuda12_runtime, "_DLL_DIR_HANDLES", []),
            ):
                cuda12_runtime.prepare_cuda12_runtime()
                self.assertIn(str(directory), os.environ["PATH"].split(os.pathsep))


if __name__ == "__main__":
    unittest.main()
