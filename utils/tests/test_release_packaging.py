import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
UTILS_DIRECTORY = REPOSITORY_ROOT / "utils"
sys.path.insert(0, str(UTILS_DIRECTORY))

from release_config import ReleaseConfig, load_release_config
import zip as release_zip


class ReleaseNamingTests(unittest.TestCase):
    def test_release_artifacts_use_vrcnt_brand(self):
        config = load_release_config(REPOSITORY_ROOT)

        self.assertEqual("VRCNT.zip", config.release_asset_zip_name)
        self.assertEqual(
            "VRCNT_${version}_x64-setup.exe",
            config.installer_name_pattern,
        )
        self.assertNotIn("Next", config.release_asset_zip_name)
        self.assertNotIn("Next", config.installer_name_pattern)

    def test_placeholder_release_artifacts_use_vrcnt_brand(self):
        config = ReleaseConfig.placeholder()

        self.assertEqual("VRCNT.zip", config.release_asset_zip_name)
        self.assertEqual(
            "VRCNT_${version}_x64-setup.exe",
            config.installer_name_pattern,
        )

    def test_package_metadata_uses_vrcnt_name(self):
        package_json = json.loads(
            (REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8")
        )
        package_lock = json.loads(
            (REPOSITORY_ROOT / "package-lock.json").read_text(encoding="utf-8")
        )

        self.assertEqual("vrcnt", package_json["name"])
        self.assertEqual("vrcnt", package_lock["name"])
        self.assertEqual("vrcnt", package_lock["packages"][""]["name"])
        self.assertEqual(
            "npm run build-cuda && python utils\\zip.py",
            package_json["scripts"]["release"],
        )

    def test_release_workflow_uses_supported_actions_and_vrcnt_branding(self):
        workflow = (
            REPOSITORY_ROOT / ".github" / "workflows" / "release.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("name: Release VRCNT\n", workflow)
        self.assertIn("name: Build and publish VRCNT\n", workflow)
        self.assertIn("uses: actions/checkout@v6", workflow)
        self.assertIn("uses: actions/setup-node@v6", workflow)
        self.assertIn("uses: actions/setup-python@v6", workflow)
        self.assertIn("uses: dtolnay/rust-toolchain@stable", workflow)
        self.assertNotIn("actions-rs/toolchain", workflow)
        self.assertIn("run: npm ci", workflow)
        self.assertIn(
            "Fallback translation cooldown timing may be delayed while translations are queued.",
            workflow,
        )

    def test_readme_discloses_queued_fallback_cooldown_issue(self):
        readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn(
            "Fallback translation cooldown timing may be delayed while translations are queued.",
            readme,
        )

    def test_version_update_succeeds_without_documentation_tree(self):
        result = subprocess.run(
            [sys.executable, "utils/update_version.py"],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("updated to version", result.stdout)


class ReleaseZipTests(unittest.TestCase):
    def test_zip_module_loads_when_tqdm_is_unavailable(self):
        script = f"""
import builtins
import importlib.util
import sys

sys.path.insert(0, {str(UTILS_DIRECTORY)!r})
original_import = builtins.__import__

def import_without_tqdm(name, *args, **kwargs):
    if name == "tqdm":
        raise ModuleNotFoundError("tqdm intentionally unavailable")
    return original_import(name, *args, **kwargs)

builtins.__import__ = import_without_tqdm
spec = importlib.util.spec_from_file_location(
    "vrcnt_release_zip",
    {str(UTILS_DIRECTORY / "zip.py")!r},
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(module.DEFAULT_RELEASE_FILES[0])
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("vrcnt.exe", result.stdout)

    def test_default_payload_contains_all_runtime_components(self):
        self.assertEqual(
            [
                "src-tauri/target/release/vrcnt.exe",
                "src-tauri/target/release/VRCT-sidecar.exe",
            ],
            getattr(release_zip, "DEFAULT_RELEASE_FILES", None),
        )
        self.assertEqual(
            [
                "src-tauri/target/release/_internal",
                "src-tauri/target/release/frontend",
            ],
            getattr(release_zip, "DEFAULT_RELEASE_DIRECTORIES", None),
        )

    def test_missing_required_payload_fails_without_creating_zip(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            zip_path = root / "VRCNT.zip"

            with self.assertRaises(FileNotFoundError):
                release_zip.zip_files_and_directory(
                    zip_path,
                    [root / "missing.exe"],
                    [],
                )

            self.assertFalse(zip_path.exists())

    def test_zip_contains_files_and_runtime_directories(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = root / "vrcnt.exe"
            sidecar = root / "VRCT-sidecar.exe"
            internal = root / "_internal"
            frontend = root / "frontend"
            executable.write_bytes(b"app")
            sidecar.write_bytes(b"sidecar")
            internal.mkdir()
            frontend.mkdir()
            (internal / "runtime.dll").write_bytes(b"runtime")
            (frontend / "index.html").write_text("VRCNT", encoding="utf-8")
            zip_path = root / "VRCNT.zip"

            result = release_zip.zip_files_and_directory(
                zip_path,
                [executable, sidecar],
                [internal, frontend],
            )

            self.assertEqual(zip_path, result)
            with zipfile.ZipFile(zip_path) as archive:
                self.assertEqual(
                    {
                        "vrcnt.exe",
                        "VRCT-sidecar.exe",
                        "_internal/runtime.dll",
                        "frontend/index.html",
                    },
                    set(archive.namelist()),
                )


if __name__ == "__main__":
    unittest.main()
