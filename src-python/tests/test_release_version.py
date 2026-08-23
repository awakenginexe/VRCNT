import inspect
import json
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "src-python"
UTILS_ROOT = ROOT / "utils"
sys.path.insert(0, os.fspath(PYTHON_ROOT))
sys.path.insert(0, os.fspath(UTILS_ROOT))

from config import config
from models.telemetry import Telemetry
from models.telemetry.client import AptabaseWrapper
from models.telemetry.core import TelemetryCore
import update_version


APP_VERSION = json.loads(
    (ROOT / "package.json").read_text(encoding="utf-8")
)["version"]


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
        ui_store = (ROOT / "src-ui" / "logics" / "store.js").read_text(
            encoding="utf-8"
        )

        self.assertEqual(package["version"], APP_VERSION)
        self.assertEqual(package_lock["version"], APP_VERSION)
        self.assertEqual(
            package_lock["packages"][""]["version"],
            APP_VERSION,
        )
        self.assertEqual(tauri["version"], APP_VERSION)
        self.assertIn(
            f'createAtomWithHook("{APP_VERSION}", "SoftwareVersion")',
            ui_store,
        )

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

    def test_all_readme_badges_report_release_version(self):
        readme_paths = (
            ROOT / "README.md",
            ROOT / "Readme" / "Readme.en.md",
            ROOT / "Readme" / "Readme.jp.md",
            ROOT / "Readme" / "Readme.kr.md",
            ROOT / "Readme" / "Readme.scn.md",
            ROOT / "Readme" / "Readme.tcn.md",
            ROOT / "Readme" / "Readme.th.md",
        )

        for readme_path in readme_paths:
            with self.subTest(readme=readme_path.name):
                content = readme_path.read_text(encoding="utf-8")
                self.assertIn(f"badge/version-{APP_VERSION}-", content)

    def test_version_updater_refreshes_all_readme_badges(self):
        readme_names = (
            "README.md",
            "Readme/Readme.en.md",
            "Readme/Readme.jp.md",
            "Readme/Readme.kr.md",
            "Readme/Readme.scn.md",
            "Readme/Readme.tcn.md",
            "Readme/Readme.th.md",
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for index, relative_name in enumerate(readme_names):
                readme_path = root / relative_name
                readme_path.parent.mkdir(parents=True, exist_ok=True)
                readme_path.write_text(
                    "\n".join(
                        (
                            f"localized marker {index}",
                            "https://img.shields.io/badge/version-0.1.2-purple",
                            "VRCNT_0.1.2_x64-setup.exe",
                        )
                    ),
                    encoding="utf-8",
                )

            update_version.update_readme_versions(
                os.fspath(root),
                "9.8.7",
            )

            for index, relative_name in enumerate(readme_names):
                with self.subTest(readme=relative_name):
                    content = (root / relative_name).read_text(encoding="utf-8")
                    self.assertIn(f"localized marker {index}", content)
                    self.assertIn("badge/version-9.8.7-", content)
                    self.assertIn("VRCNT_9.8.7_x64-setup.exe", content)

    def test_whisper_dependency_uses_vad_upgrade(self):
        for filename in ("requirements.txt", "requirements_cuda.txt"):
            requirements = (
                ROOT / filename
            ).read_text(encoding="utf-8").splitlines()
            self.assertIn("faster-whisper==1.2.1", requirements)
            self.assertIn("ctranslate2==4.8.1", requirements)
            self.assertIn("transformers==5.5.0", requirements)
            self.assertIn("tokenizers==0.22.2", requirements)

    def test_cuda_runtime_matches_ctranslate2(self):
        requirements = (
            ROOT / "requirements_cuda.txt"
        ).read_text(encoding="utf-8").splitlines()

        self.assertIn("torch==2.11.0", requirements)
        self.assertIn(
            "--extra-index-url https://download.pytorch.org/whl/cu128",
            requirements,
        )
        self.assertIn("ctranslate2==4.8.1", requirements)
        self.assertIn(
            "sherpa-onnx==1.13.0+cuda12.cudnn9",
            requirements,
        )
        self.assertNotIn(
            "--extra-index-url https://download.pytorch.org/whl/cu130",
            requirements,
        )


if __name__ == "__main__":
    unittest.main()
