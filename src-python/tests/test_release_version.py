import inspect
import json
import os
import sys
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "src-python"
sys.path.insert(0, os.fspath(PYTHON_ROOT))

from config import config
from models.telemetry import Telemetry
from models.telemetry.client import AptabaseWrapper
from models.telemetry.core import TelemetryCore


APP_VERSION = "4.2.0"


class ReleaseVersionTests(unittest.TestCase):
    def test_json_package_surfaces_report_release_version(self):
        package = json.loads(
            (ROOT / "package.json").read_text(encoding="utf-8")
        )
        package_lock = json.loads(
            (ROOT / "package-lock.json").read_text(encoding="utf-8")
        )
        tauri = json.loads(
            (ROOT / "src-tauri" / "tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(package["version"], APP_VERSION)
        self.assertEqual(package_lock["version"], APP_VERSION)
        self.assertEqual(
            package_lock["packages"][""]["version"],
            APP_VERSION,
        )
        self.assertEqual(tauri["version"], APP_VERSION)

    def test_rust_application_package_reports_release_version(self):
        cargo_manifest = tomllib.loads(
            (ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
        )
        cargo_lock = tomllib.loads(
            (ROOT / "src-tauri" / "Cargo.lock").read_text(encoding="utf-8")
        )
        vrcnt_package = next(
            package
            for package in cargo_lock["package"]
            if package["name"] == "vrcnt"
        )

        self.assertEqual(cargo_manifest["package"]["version"], APP_VERSION)
        self.assertEqual(vrcnt_package["version"], APP_VERSION)

    def test_python_runtime_defaults_report_release_version(self):
        self.assertEqual(config.VERSION, APP_VERSION)
        for function in (
            Telemetry.init,
            TelemetryCore.start,
            AptabaseWrapper.start,
        ):
            default = inspect.signature(function).parameters[
                "app_version"
            ].default
            self.assertEqual(default, APP_VERSION)

    def test_whisper_dependency_uses_vad_upgrade(self):
        for filename in ("requirements.txt", "requirements_cuda.txt"):
            requirements = (
                ROOT / filename
            ).read_text(encoding="utf-8").splitlines()
            self.assertIn("faster-whisper==1.2.1", requirements)
            self.assertIn("ctranslate2==4.6.0", requirements)


if __name__ == "__main__":
    unittest.main()
