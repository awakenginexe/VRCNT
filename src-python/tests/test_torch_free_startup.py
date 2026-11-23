import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src-python"))


def _torch(*names):
    cuda = types.SimpleNamespace(
        is_available=lambda: bool(names),
        device_count=lambda: len(names),
        get_device_name=lambda index: names[index],
    )
    return types.SimpleNamespace(cuda=cuda)


class CudaDeviceNamesTests(unittest.TestCase):
    def _names(self, *, runtime, cuda_count, driver_names, torch):
        import cuda12_runtime
        import resource_usage
        import utils

        ctranslate2 = types.SimpleNamespace(get_cuda_device_count=lambda: cuda_count)
        with (
            mock.patch.object(cuda12_runtime, "prepare_cuda12_runtime", return_value=runtime),
            mock.patch.object(resource_usage, "gpu_device_names", return_value=driver_names),
            mock.patch.object(utils.importlib, "import_module", return_value=ctranslate2),
            mock.patch.object(utils, "_getTorch", torch),
        ):
            return utils._getCudaDeviceNames()

    def test_cpu_runtime_reports_no_cuda_device_without_torch(self):
        torch = mock.Mock(side_effect=AssertionError("torch must not be imported"))
        self.assertEqual([], self._names(runtime=False, cuda_count=1, driver_names=["RTX"], torch=torch))

    def test_single_gpu_is_named_by_the_driver_without_torch(self):
        torch = mock.Mock(side_effect=AssertionError("torch must not be imported"))
        self.assertEqual(
            ["NVIDIA GeForce RTX 3070 Ti"],
            self._names(runtime=True, cuda_count=1, driver_names=["NVIDIA GeForce RTX 3070 Ti"], torch=torch),
        )

    def test_several_gpus_keep_torch_cuda_ordering(self):
        self.assertEqual(
            ["RTX 4090", "GTX 1060"],
            self._names(
                runtime=True,
                cuda_count=2,
                driver_names=["GTX 1060", "RTX 4090"],
                torch=lambda: _torch("RTX 4090", "GTX 1060"),
            ),
        )


class ResourceUsageGpuSourceTests(unittest.TestCase):
    ROW = {
        "device_index": 0,
        "device_name": "GPU",
        "gpu_percent": 10.0,
        "memory_used": 2.0,
        "memory_total": 8.0,
    }

    def test_driver_library_is_used_before_starting_nvidia_smi(self):
        import resource_usage

        with (
            mock.patch.object(resource_usage, "_nvml_rows", return_value=[self.ROW]),
            mock.patch.object(resource_usage, "_nvidia_smi_rows") as nvidia_smi,
        ):
            usage = resource_usage.collect_resource_usage(0)
        nvidia_smi.assert_not_called()
        self.assertEqual({"available": True, "percent": 25.0}, usage["vram"])

    def test_nvidia_smi_remains_the_fallback(self):
        import resource_usage

        with (
            mock.patch.object(resource_usage, "_nvml_rows", return_value=None),
            mock.patch.object(resource_usage, "_nvidia_smi_rows", return_value=[self.ROW]),
        ):
            usage = resource_usage.collect_resource_usage(0)
        self.assertEqual({"available": True, "percent": 10.0}, usage["gpu"])


class BackendStartupTests(unittest.TestCase):
    def test_backend_import_does_not_load_torch_or_transformers(self):
        with tempfile.TemporaryDirectory() as data_root:
            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import sys, mainloop;"
                    "print([name for name in ('torch', 'transformers') if name in sys.modules])",
                ],
                cwd=str(ROOT / "src-python"),
                env={**os.environ, "LOCALAPPDATA": data_root, "APPDATA": data_root},
                capture_output=True,
                text=True,
                timeout=180,
            )
        self.assertEqual(0, completed.returncode, completed.stderr[-2000:])
        self.assertEqual("[]", completed.stdout.strip().splitlines()[-1])


if __name__ == "__main__":
    unittest.main()
