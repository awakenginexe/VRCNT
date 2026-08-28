import os
import sys
import json
import unittest


REPOSITORY_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", ".."),
)
sys.path.insert(0, os.path.join(REPOSITORY_ROOT, "utils"))

from release import split_to_asset_limit, write_combined_manifest
from release_config import build_release_urls, load_release_config


class ReleaseConfigTests(unittest.TestCase):
    def test_vrcnt_release_urls_use_github_release_assets(self):
        with open(
            os.path.join(REPOSITORY_ROOT, "package.json"),
            "r",
            encoding="utf-8",
        ) as package_file:
            version = json.load(package_file)["version"]

        config = load_release_config(REPOSITORY_ROOT)
        urls = build_release_urls(config, version)

        self.assertEqual(config.github_owner, "awakenginexe")
        self.assertEqual(config.github_repo, "VRCNT")
        self.assertEqual(
            urls.release_url,
            "https://github.com/awakenginexe/VRCNT/releases",
        )
        self.assertEqual(
            urls.latest_json_url,
            "https://github.com/awakenginexe/VRCNT/releases/latest/download/latest.json",
        )
        self.assertEqual(
            urls.installer_url,
            "https://github.com/awakenginexe/VRCNT/releases/"
            f"download/v{version}/VRCNT_{version}_Setup.exe",
        )
        self.assertEqual(
            urls.raw_package_json_url,
            "https://raw.githubusercontent.com/awakenginexe/VRCNT/main/package.json",
        )

    def test_release_manifests_and_readme_share_the_package_version(self):
        with open(
            os.path.join(REPOSITORY_ROOT, "package.json"),
            "r",
            encoding="utf-8",
        ) as package_file:
            package = json.load(package_file)
        with open(
            os.path.join(
                REPOSITORY_ROOT,
                "src-tauri",
                "tauri.conf.json",
            ),
            "r",
            encoding="utf-8",
        ) as tauri_file:
            tauri_config = json.load(tauri_file)
        with open(
            os.path.join(REPOSITORY_ROOT, "README.md"),
            "r",
            encoding="utf-8",
        ) as readme_file:
            readme = readme_file.read()

        self.assertEqual(tauri_config["version"], package["version"])
        self.assertIn(f"badge/version-{package['version']}-", readme)

    def test_release_config_uses_variant_archives_and_schema_two_manifest(self):
        config = load_release_config(REPOSITORY_ROOT)
        self.assertFalse(hasattr(config, "package_part_count"))
        self.assertEqual(config.package_name("5.15.0", "cpu"), "VRCNT_5.15.0_CPU.7z")
        self.assertEqual(config.package_name("v5.15.0", "CUDA"), "VRCNT_5.15.0_CUDA.7z")
        self.assertEqual(config.installer_name("5.15.0"), "VRCNT_5.15.0_Setup.exe")

        with self.subTest("variable part counts and signed-manifest inputs"):
            import tempfile

            with tempfile.TemporaryDirectory() as temporary_directory:
                root = os.path.abspath(temporary_directory)
                cpu_dir = os.path.join(root, "cpu")
                cuda_dir = os.path.join(root, "cuda")
                os.makedirs(cpu_dir)
                os.makedirs(cuda_dir)
                cpu_archive = os.path.join(cpu_dir, "VRCNT_5.15.0_CPU.7z")
                cuda_archive = os.path.join(cuda_dir, "VRCNT_5.15.0_CUDA.7z")
                with open(cpu_archive, "wb") as stream:
                    stream.write(b"cpu")
                with open(cuda_archive, "wb") as stream:
                    stream.write(b"cuda-payload")

                cpu_parts = split_to_asset_limit(cpu_archive, 4)
                cuda_parts = split_to_asset_limit(cuda_archive, 5)
                self.assertEqual(len(cpu_parts), 1)
                self.assertEqual(len(cuda_parts), 3)

                def write_metadata(directory, variant, parts, build_identity):
                    entries = []
                    for part in parts:
                        with open(part, "rb") as stream:
                            import hashlib

                            entries.append({
                                "name": os.path.basename(part),
                                "size": os.path.getsize(part),
                                "sha256": hashlib.file_digest(stream, "sha256").hexdigest(),
                            })
                    with open(os.path.join(directory, "package-metadata.json"), "w", encoding="utf-8") as stream:
                        json.dump({
                            "variant": variant,
                            "archiveFormat": "7z",
                            "compressedSize": sum(item["size"] for item in entries),
                            "installedSize": 42,
                            "parts": entries,
                            "requiresNvidia": variant == "cuda",
                            "markerPath": "VRCNT.runtime.json",
                            "identity": {
                                "product": "VRCNT",
                                "version": "5.15.0",
                                "variant": variant.title(),
                                "architecture": "x64",
                                "buildIdentity": build_identity,
                                "markerSha256": "a" * 64,
                            },
                        }, stream)

                write_metadata(cpu_dir, "cpu", cpu_parts, "cpu-fixture")
                write_metadata(cuda_dir, "cuda", cuda_parts, "cuda-fixture")
                setup = os.path.join(root, "VRCNT_5.15.0_Setup.exe")
                with open(setup, "wb") as stream:
                    stream.write(b"setup")
                manifest_path = os.path.join(root, "package-manifest.json")
                manifest = write_combined_manifest("5.15.0", cpu_dir, cuda_dir, setup, manifest_path)

                self.assertEqual(manifest["schema"], 2)
                self.assertEqual(manifest["bootstrapper"]["name"], "VRCNT_5.15.0_Setup.exe")
                self.assertEqual(len(manifest["variants"]["cpu"]["parts"]), 1)
                self.assertEqual(len(manifest["variants"]["cuda"]["parts"]), 3)
                self.assertEqual(manifest["variants"]["cuda"]["identity"]["buildIdentity"], "cuda-fixture")


if __name__ == "__main__":
    unittest.main()
