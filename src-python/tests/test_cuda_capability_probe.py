import contextlib
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock


SRC_PYTHON = Path(__file__).resolve().parents[1]
if str(SRC_PYTHON) not in sys.path:
    sys.path.insert(0, str(SRC_PYTHON))


class CudaCapabilityProbeTests(unittest.TestCase):
    def test_success_reports_a_strict_conclusive_json_contract(self):
        from cuda_capability_probe import run_cuda_capability_probe

        output = io.StringIO()
        with contextlib.redirect_stdout(output), mock.patch("cuda_capability_probe.probe_local_cuda_backend", return_value=(True, True, None, None)):
            exit_code = run_cuda_capability_probe()

        self.assertEqual(0, exit_code)
        self.assertEqual(
            {"supported": True, "conclusive": True, "failureCode": None, "detail": None},
            json.loads(output.getvalue()),
        )

    def test_unsupported_cuda_reports_a_conclusive_safe_failure(self):
        from cuda_capability_probe import run_cuda_capability_probe

        output = io.StringIO()
        with contextlib.redirect_stdout(output), mock.patch("cuda_capability_probe.probe_local_cuda_backend", return_value=(False, True, "cuda_unavailable", "No compatible local CUDA device is available.")):
            exit_code = run_cuda_capability_probe()

        self.assertEqual(0, exit_code)
        self.assertEqual("cuda_unavailable", json.loads(output.getvalue())["failureCode"])

    def test_entrypoint_short_circuits_before_controller_initialization_for_probe_mode(self):
        source = (SRC_PYTHON / "mainloop.py").read_text(encoding="utf-8")
        cuda_spec = (SRC_PYTHON.parent / "spec" / "backend_cuda.spec").read_text(encoding="utf-8")

        self.assertLess(source.index("run_cuda_capability_probe"), source.index("from controller import Controller"))
        self.assertIn("--cuda-capability-probe", source)
        self.assertIn("--offline", source)
        self.assertIn("'torch'", cuda_spec)

    def test_probe_classifies_missing_cuda_dependencies_without_attempting_models_or_network(self):
        from cuda_capability_probe import probe_local_cuda_backend

        with mock.patch("cuda_capability_probe.importlib.import_module", side_effect=ModuleNotFoundError("torch")) as importer:
            result = probe_local_cuda_backend()

        self.assertEqual((False, True, "cuda_dependency_unavailable", "The packaged CUDA dependencies are unavailable."), result)
        self.assertEqual([mock.call("torch")], importer.call_args_list)

    def test_mainloop_executes_the_probe_entrypoint_without_starting_controller_initialization(self):
        result = subprocess.run(
            [sys.executable, str(SRC_PYTHON / "mainloop.py"), "--cuda-capability-probe", "--offline"],
            cwd=SRC_PYTHON,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({"supported", "conclusive", "failureCode", "detail"}, set(json.loads(result.stdout)))
        self.assertNotIn("initialization", result.stdout.lower())


if __name__ == "__main__":
    unittest.main()
