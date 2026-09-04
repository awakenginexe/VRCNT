import json
import re
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
UTILS_DIRECTORY = REPOSITORY_ROOT / "utils"
sys.path.insert(0, str(UTILS_DIRECTORY))

from release_config import ReleaseConfig, load_release_config
from release import REQUIRED_PAYLOAD_DIRECTORIES, REQUIRED_PAYLOAD_FILES, latest, validate_payload
import update_version


class ReleaseNamingTests(unittest.TestCase):
    def test_release_artifacts_use_vrcnt_brand(self):
        config = load_release_config(REPOSITORY_ROOT)

        self.assertEqual("VRCNT_${version}_${variant}.7z", config.package_name_pattern)
        self.assertEqual(
            "VRCNT_${version}_Setup.exe",
            config.installer_name_pattern,
        )
        self.assertNotIn("Next", config.package_name_pattern)
        self.assertNotIn("Next", config.installer_name_pattern)

    def test_placeholder_release_artifacts_use_vrcnt_brand(self):
        config = ReleaseConfig.placeholder()

        self.assertEqual("VRCNT_${version}_${variant}.7z", config.package_name_pattern)
        self.assertEqual(
            "VRCNT_${version}_Setup.exe",
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
        self.assertIn("name: Package, sign, and publish VRCNT\n", workflow)
        self.assertIn("uses: actions/checkout@v6", workflow)
        self.assertIn("uses: actions/setup-node@v6", workflow)
        self.assertIn("uses: actions/setup-python@v6", workflow)
        self.assertIn("uses: dtolnay/rust-toolchain@stable", workflow)
        self.assertNotIn("actions-rs/toolchain", workflow)
        self.assertIn("run: npm ci", workflow)
        self.assertIn("python ./utils/release.py package", workflow)

    def test_candidate_workflow_publishes_only_the_approved_exact_prerelease(self):
        workflow = (
            REPOSITORY_ROOT / ".github" / "workflows" / "test-candidate.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("RELEASE_TAG: v5.15.0-rc.1", workflow)
        self.assertIn("--release-tag $env:RELEASE_TAG", workflow)
        self.assertIn("--draft --prerelease", workflow)
        self.assertIn("--draft=false --prerelease", workflow)
        self.assertNotIn("--draft=false --prerelease=false", workflow)

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
    def test_latest_metadata_can_target_an_exact_prerelease_tag(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            signature = root / "setup.sig"
            output = root / "latest.json"
            signature.write_text("signed", encoding="utf-8")

            latest("5.15.0", "VRCNT_5.15.0_Setup.exe", signature, output, "2026-09-04T00:00:00Z", release_tag="v5.15.0-rc.1")

            document = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(
                "https://github.com/awakenginexe/VRCNT/releases/download/v5.15.0-rc.1/VRCNT_5.15.0_Setup.exe",
                document["platforms"]["windows-x86_64"]["url"],
            )

    def test_release_module_loads_without_optional_dependencies(self):
        script = f"""
import sys

sys.path.insert(0, {str(UTILS_DIRECTORY)!r})
import release
print(release.REQUIRED_PAYLOAD_FILES[0])
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
            ("VRCNT.exe", "VRCNT-backend.exe", "VRCNT.runtime.json"),
            REQUIRED_PAYLOAD_FILES,
        )
        self.assertEqual(("_internal", "frontend"), REQUIRED_PAYLOAD_DIRECTORIES)

    def test_missing_required_payload_fails_without_creating_zip(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with self.assertRaises(FileNotFoundError):
                validate_payload(root)

    def test_valid_payload_contains_files_and_runtime_directories(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = root / "VRCNT.exe"
            sidecar = root / "VRCNT-backend.exe"
            marker = root / "VRCNT.runtime.json"
            internal = root / "_internal"
            frontend = root / "frontend"
            executable.write_bytes(b"app")
            sidecar.write_bytes(b"sidecar")
            marker.write_text("{}", encoding="utf-8")
            internal.mkdir()
            frontend.mkdir()
            (internal / "runtime.dll").write_bytes(b"runtime")
            (frontend / "index.html").write_text("VRCNT", encoding="utf-8")
            validate_payload(root)


class VersionConsistencyTests(unittest.TestCase):
    def test_all_active_release_surfaces_report_target_version(self):
        target_version = "5.15.0"
        package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
        package_lock = json.loads(
            (REPOSITORY_ROOT / "package-lock.json").read_text(encoding="utf-8")
        )
        tauri = json.loads(
            (REPOSITORY_ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
        )
        cargo_manifest = tomllib.loads(
            (REPOSITORY_ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
        )
        cargo_lock = tomllib.loads(
            (REPOSITORY_ROOT / "src-tauri" / "Cargo.lock").read_text(encoding="utf-8")
        )
        vrcnt_package = next(
            item for item in cargo_lock["package"] if item["name"] == "vrcnt"
        )

        self.assertEqual(target_version, package["version"])
        self.assertEqual(target_version, package_lock["version"])
        self.assertEqual(target_version, package_lock["packages"][""]["version"])
        self.assertEqual(target_version, tauri["version"])
        self.assertEqual(target_version, cargo_manifest["package"]["version"])
        self.assertEqual(target_version, vrcnt_package["version"])
        runtime_manager = (
            REPOSITORY_ROOT / "src-tauri" / "src" / "runtime_manager.rs"
        ).read_text(encoding="utf-8")
        self.assertIn(f'None => "v{target_version}",', runtime_manager)
        self.assertIn(f'const MANAGER_VERSION: &str = "{target_version}";', runtime_manager)

        config = (REPOSITORY_ROOT / "src-python" / "config.py").read_text(encoding="utf-8")
        self.assertRegex(config, rf'self\._VERSION = "{re.escape(target_version)}"')
        ui_store = (REPOSITORY_ROOT / "src-ui" / "logics" / "store.js").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            f'createAtomWithHook("{target_version}", "SoftwareVersion")',
            ui_store,
        )

        for path in (
            REPOSITORY_ROOT / "src-python" / "models" / "telemetry" / "__init__.py",
            REPOSITORY_ROOT / "src-python" / "models" / "telemetry" / "core.py",
            REPOSITORY_ROOT / "src-python" / "models" / "telemetry" / "client.py",
        ):
            self.assertRegex(
                path.read_text(encoding="utf-8"),
                rf'app_version: str = "{re.escape(target_version)}"',
            )

        for path in (
            REPOSITORY_ROOT / "installer-helper" / "VRCNT.RuntimeCore" / "VRCNT.RuntimeCore.csproj",
            REPOSITORY_ROOT / "installer-helper" / "VRCNT.Setup" / "VRCNT.Setup.csproj",
        ):
            self.assertIn(
                f"<Version>{target_version}</Version>",
                path.read_text(encoding="utf-8"),
            )

        for path in (
            REPOSITORY_ROOT / "README.md",
            REPOSITORY_ROOT / "Readme" / "Readme.en.md",
            REPOSITORY_ROOT / "Readme" / "Readme.jp.md",
            REPOSITORY_ROOT / "Readme" / "Readme.kr.md",
            REPOSITORY_ROOT / "Readme" / "Readme.scn.md",
            REPOSITORY_ROOT / "Readme" / "Readme.tcn.md",
            REPOSITORY_ROOT / "Readme" / "Readme.th.md",
        ):
            self.assertIn(
                f"badge/version-{target_version}-",
                path.read_text(encoding="utf-8"),
            )

        release_config = json.loads(
            (REPOSITORY_ROOT / "release.config.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            "VRCNT_${version}_${variant}.7z",
            release_config["packageNamePattern"],
        )
        self.assertEqual(
            "VRCNT_${version}_Setup.exe",
            release_config["installerNamePattern"],
        )
        self.assertNotIn("5.14.0", json.dumps(release_config))

        build_document = (REPOSITORY_ROOT / "BUILD.md").read_text(encoding="utf-8")
        self.assertIn(f"VRCNT {target_version}", build_document)
        workflow = (
            REPOSITORY_ROOT / ".github" / "workflows" / "release.yml"
        ).read_text(encoding="utf-8")
        self.assertIn(f"v{target_version}", workflow)
        self.assertNotIn("5.14.0", workflow)

        nsis_template = (
            REPOSITORY_ROOT / "src-tauri" / "nsis" / "template.nsi"
        ).read_text(encoding="utf-8")
        self.assertIn(
            '!define PACKAGE_MANIFEST_NAME "package-manifest.json"',
            nsis_template,
        )
        self.assertNotIn("PACKAGE_PART_COUNT", nsis_template)


class VersionUpdaterTests(unittest.TestCase):
    def test_readme_setup_names_follow_modern_and_legacy_formats(self):
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
            for relative_name in readme_names:
                readme_path = root / relative_name
                readme_path.parent.mkdir(parents=True, exist_ok=True)
                readme_path.write_text(
                    "\n".join(
                        (
                            "https://img.shields.io/badge/version-0.1.2-purple",
                            "VRCNT_0.1.2_x64-setup.exe",
                            "VRCNT_0.1.2_Setup.exe",
                        )
                    ),
                    encoding="utf-8",
                )

            update_version.update_readme_versions(str(root), "9.8.7")

            for relative_name in readme_names:
                content = (root / relative_name).read_text(encoding="utf-8")
                self.assertIn("VRCNT_9.8.7_x64-setup.exe", content)
                self.assertIn("VRCNT_9.8.7_Setup.exe", content)


if __name__ == "__main__":
    unittest.main()
