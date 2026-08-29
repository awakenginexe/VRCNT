import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STAGE_SCRIPT = ROOT / "scripts" / "stage_runtime.ps1"
VALIDATE_SCRIPT = ROOT / "scripts" / "validate_runtime_payload.ps1"
VERSION = "5.15.0"
SOURCE_COMMIT = "a" * 40
BUILD_RECIPE = "fixture-pyinstaller-v1"
CUDA_MARKERS = (
    "_internal/torch/lib/torch_cuda.dll",
    "_internal/torch/lib/cudnn64_9.dll",
    "_internal/torch/lib/cublas64_12.dll",
    "_internal/onnxruntime/capi/onnxruntime_providers_cuda.dll",
    "_internal/sherpa_onnx/lib/sherpa-onnx-cuda.dll",
)
BUILT_BACKEND_NAME = "VRCNT-backend-x86_64-pc-windows-msvc.exe"


class RuntimePayloadBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.shell = self.root / "shell"
        self.cpu_backend = self.root / "backend-cpu"
        self.cuda_backend = self.root / "backend-cuda"
        self.cpu_payload = self.root / "payload-cpu"
        self.cuda_payload = self.root / "payload-cuda"
        self._write(self.shell / "VRCNT.exe", b"shared-shell")
        self._write(self.shell / "frontend" / "index.html", b"shared-frontend")
        self._write(self.cpu_backend / BUILT_BACKEND_NAME, b"cpu-backend")
        self._write(
            self.cpu_backend / "_internal" / "onnxruntime" / "onnxruntime.dll",
            b"cpu-onnx",
        )
        self._write(self.cuda_backend / BUILT_BACKEND_NAME, b"cuda-backend")
        for marker in CUDA_MARKERS:
            self._write(self.cuda_backend / marker, marker.encode("utf-8"))

    def tearDown(self):
        self.temporary.cleanup()

    def test_staging_separates_cpu_and_cuda_libraries_and_binds_physical_identities(self):
        self._stage("cpu", self.cpu_backend, self.cpu_payload)
        self._stage("cuda", self.cuda_backend, self.cuda_payload)
        self._validate("cpu", self.cpu_payload)
        self._validate("cuda", self.cuda_payload)

        cpu_files = self._relative_files(self.cpu_payload)
        cuda_files = self._relative_files(self.cuda_payload)
        for marker in CUDA_MARKERS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, cpu_files)
                self.assertIn(marker, cuda_files)

        self.assertEqual(
            self._sha256(self.cpu_payload / "VRCNT.exe"),
            self._sha256(self.cuda_payload / "VRCNT.exe"),
        )
        self.assertEqual(
            self._sha256(self.cpu_payload / "frontend" / "index.html"),
            self._sha256(self.cuda_payload / "frontend" / "index.html"),
        )

        cpu_marker = self._marker(self.cpu_payload)
        cuda_marker = self._marker(self.cuda_payload)
        for marker, variant in ((cpu_marker, "Cpu"), (cuda_marker, "Cuda")):
            with self.subTest(variant=variant):
                self.assertEqual(marker["product"], "VRCNT")
                self.assertEqual(marker["version"], VERSION)
                self.assertEqual(marker["variant"], variant)
                self.assertEqual(marker["architecture"], "x64")
                self.assertEqual(marker["sourceCommit"], SOURCE_COMMIT)
                self.assertEqual(marker["buildRecipe"], BUILD_RECIPE)
                self.assertRegex(marker["sharedShellIdentity"], r"^[0-9a-f]{64}$")
                self.assertRegex(marker["backendPayloadIdentity"], r"^[0-9a-f]{64}$")
                self.assertRegex(marker["buildIdentity"], r"^[0-9a-f]{64}$")
        self.assertEqual(cpu_marker["sharedShellIdentity"], cuda_marker["sharedShellIdentity"])
        self.assertNotEqual(cpu_marker["buildIdentity"], cuda_marker["buildIdentity"])
        for payload in (self.cpu_payload, self.cuda_payload):
            self.assertTrue((payload / "VRCNT-backend.exe").is_file())
            self.assertFalse((payload / BUILT_BACKEND_NAME).exists())

    def test_cpu_validation_ignores_python_cudnn_modules_and_license_metadata(self):
        self._write(
            self.cpu_backend / "_internal" / "torch" / "backends" / "cudnn" / "__init__.py",
            b"cpu-compatible python module",
        )
        self._write(
            self.cpu_backend
            / "_internal"
            / "torch-2.13.0.dist-info"
            / "licenses"
            / "third_party"
            / "cudnn_frontend"
            / "LICENSE.txt",
            b"license metadata",
        )

        self._stage("cpu", self.cpu_backend, self.cpu_payload)
        self._validate("cpu", self.cpu_payload)

    def test_cpu_validation_rejects_each_cuda_library_boundary(self):
        self._stage("cpu", self.cpu_backend, self.cpu_payload)
        for marker in CUDA_MARKERS:
            with self.subTest(marker=marker):
                self._write(self.cpu_payload / marker, b"forbidden-cuda-library")
                result = self._powershell(
                    VALIDATE_SCRIPT,
                    "-Variant", "cpu",
                    "-PayloadPath", self.cpu_payload,
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                (self.cpu_payload / marker).unlink()

    def test_cuda_validation_requires_each_dependency_boundary(self):
        for missing in CUDA_MARKERS:
            with self.subTest(missing=missing):
                payload = self.root / ("cuda-missing-" + Path(missing).stem)
                self._stage("cuda", self.cuda_backend, payload)
                (payload / missing).unlink()
                result = self._powershell(
                    VALIDATE_SCRIPT,
                    "-Variant", "cuda",
                    "-PayloadPath", payload,
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_physical_payload_mutation_invalidates_the_identity(self):
        self._stage("cpu", self.cpu_backend, self.cpu_payload)
        self._write(self.cpu_payload / "frontend" / "index.html", b"tampered")

        result = self._powershell(
            VALIDATE_SCRIPT,
            "-Variant", "cpu",
            "-PayloadPath", self.cpu_payload,
        )

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_staging_rejects_an_identity_marker_from_the_shared_shell(self):
        self._write(self.shell / "VRCNT.runtime.json", b"untrusted-marker")

        result = self._powershell(
            STAGE_SCRIPT,
            "-Variant", "cpu",
            "-ShellPath", self.shell,
            "-BackendPayloadPath", self.cpu_backend,
            "-OutputPath", self.cpu_payload,
            "-Version", VERSION,
            "-SourceCommit", SOURCE_COMMIT,
            "-BuildRecipe", BUILD_RECIPE,
        )

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(
            "The shared shell must not provide a runtime identity marker.",
            result.stdout + result.stderr,
        )

    def test_cpu_staging_rejects_a_nested_cuda_backend_and_creates_no_payload(self):
        self._write(
            self.cpu_backend / "nested-cuda" / "VRCNT-BACKEND-CUDA.EXE",
            b"nested-cuda-backend",
        )

        result = self._powershell(
            STAGE_SCRIPT,
            "-Variant", "cpu",
            "-ShellPath", self.shell,
            "-BackendPayloadPath", self.cpu_backend,
            "-OutputPath", self.cpu_payload,
            "-Version", VERSION,
            "-SourceCommit", SOURCE_COMMIT,
            "-BuildRecipe", BUILD_RECIPE,
        )

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("additional backend executable", (result.stdout + result.stderr).lower())
        self.assertFalse(self.cpu_payload.exists())

    def test_shared_analysis_selects_only_the_requested_environment(self):
        spec_root = ROOT / "spec"
        sys.path.insert(0, str(spec_root))
        try:
            from backend_common import backend_analysis_configuration
        finally:
            sys.path.remove(str(spec_root))

        cpu_environment = self.root / ".venv"
        cuda_environment = self.root / ".venv_cuda"
        cpu = backend_analysis_configuration("cpu", ROOT, cpu_environment)
        cuda = backend_analysis_configuration("cuda", ROOT, cuda_environment)

        self.assertEqual("cpu", cpu["variant"])
        self.assertEqual("cuda", cuda["variant"])
        self.assertTrue(all(Path(source).is_relative_to(cpu_environment) for source, _ in cpu["environment_datas"]))
        self.assertTrue(all(Path(source).is_relative_to(cuda_environment) for source, _ in cuda["environment_datas"]))
        self.assertIn("torch", cpu["hiddenimports"])
        self.assertNotIn("torch.cuda", cpu["hiddenimports"])
        self.assertNotIn("torch.backends.cuda", cpu["hiddenimports"])
        self.assertIn("torch.cuda", cuda["hiddenimports"])
        self.assertIn("torch.backends.cuda", cuda["hiddenimports"])

    def _stage(self, variant, backend, output):
        result = self._powershell(
            STAGE_SCRIPT,
            "-Variant", variant,
            "-ShellPath", self.shell,
            "-BackendPayloadPath", backend,
            "-OutputPath", output,
            "-Version", VERSION,
            "-SourceCommit", SOURCE_COMMIT,
            "-BuildRecipe", BUILD_RECIPE,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def _validate(self, variant, payload):
        result = self._powershell(
            VALIDATE_SCRIPT,
            "-Variant", variant,
            "-PayloadPath", payload,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @staticmethod
    def _write(path, contents):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)

    @staticmethod
    def _relative_files(root):
        return {
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.is_file()
        }

    @staticmethod
    def _sha256(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    @staticmethod
    def _marker(payload):
        return json.loads((payload / "VRCNT.runtime.json").read_text(encoding="utf-8"))

    @staticmethod
    def _powershell(script, *arguments):
        return subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), *map(str, arguments)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
