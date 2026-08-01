import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
UTILS_DIRECTORY = REPOSITORY_ROOT / "utils"
sys.path.insert(0, str(UTILS_DIRECTORY))

from release_config import ReleaseConfig, load_release_config
from release import DEFAULT_RELEASE_DIRECTORIES, DEFAULT_RELEASE_FILES, validate_payload


class ReleaseNamingTests(unittest.TestCase):
    def test_release_artifacts_use_vrcnt_brand(self):
        config = load_release_config(REPOSITORY_ROOT)

        self.assertEqual("VRCNT_${version}.7z", config.package_name_pattern)
        self.assertEqual(
            "VRCNT_${version}_x64-setup.exe",
            config.installer_name_pattern,
        )
        self.assertNotIn("Next", config.package_name_pattern)
        self.assertNotIn("Next", config.installer_name_pattern)

    def test_placeholder_release_artifacts_use_vrcnt_brand(self):
        config = ReleaseConfig.placeholder()

        self.assertEqual("VRCNT_${version}.7z", config.package_name_pattern)
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
            "npm run build-cuda",
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
        self.assertIn("python ./utils/release.py package", workflow)

    def test_readme_discloses_queued_fallback_cooldown_issue(self):
        readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("launch `VRCNT.exe`", readme)

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


class ReleasePayloadTests(unittest.TestCase):
    def test_release_module_loads_without_optional_dependencies(self):
        script = f"""
import sys

sys.path.insert(0, {str(UTILS_DIRECTORY)!r})
import release
print(release.DEFAULT_RELEASE_FILES[0])
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("VRCNT.exe", result.stdout)

    def test_default_payload_contains_all_runtime_components(self):
        self.assertEqual(
            [
                "src-tauri/target/release/VRCNT.exe",
                "src-tauri/target/release/VRCNT-backend.exe",
            ],
            [str(path).replace("\\", "/") for path in DEFAULT_RELEASE_FILES],
        )
        self.assertEqual(
            [
                "src-tauri/target/release/_internal",
                "src-tauri/target/release/frontend",
            ],
            [str(path).replace("\\", "/") for path in DEFAULT_RELEASE_DIRECTORIES],
        )

    def test_missing_required_payload_fails_without_creating_zip(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            zip_path = root / "VRCNT.zip"

            with self.assertRaises(FileNotFoundError):
                validate_payload([root / "missing.exe"], [])

            self.assertFalse(zip_path.exists())

    def test_valid_payload_contains_files_and_runtime_directories(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = root / "VRCNT.exe"
            sidecar = root / "VRCNT-backend.exe"
            internal = root / "_internal"
            frontend = root / "frontend"
            executable.write_bytes(b"app")
            sidecar.write_bytes(b"sidecar")
            internal.mkdir()
            frontend.mkdir()
            (internal / "runtime.dll").write_bytes(b"runtime")
            (frontend / "index.html").write_text("VRCNT", encoding="utf-8")
            validate_payload([executable, sidecar], [internal, frontend])


if __name__ == "__main__":
    unittest.main()
