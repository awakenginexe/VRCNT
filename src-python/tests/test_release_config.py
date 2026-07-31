import os
import sys
import json
import unittest


REPOSITORY_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", ".."),
)
sys.path.insert(0, os.path.join(REPOSITORY_ROOT, "utils"))

from release_config import build_release_urls, load_release_config


class ReleaseConfigTests(unittest.TestCase):
    def test_vrcnt_4_2_0_urls_use_renamed_repositories(self):
        config = load_release_config(REPOSITORY_ROOT)
        urls = build_release_urls(config, "4.2.0")

        self.assertEqual(config.github_owner, "awakenginexe")
        self.assertEqual(config.github_repo, "VRCNT")
        self.assertEqual(config.hf_repo_id, "AwakeNgineXE/VRCNT")
        self.assertEqual(
            urls.release_url,
            "https://github.com/awakenginexe/VRCNT/releases",
        )
        self.assertEqual(
            urls.latest_json_url,
            (
                "https://huggingface.co/AwakeNgineXE/VRCNT/"
                "resolve/main/latest.json"
            ),
        )
        self.assertEqual(
            urls.installer_url,
            (
                "https://huggingface.co/AwakeNgineXE/VRCNT/"
                "resolve/v4.2.0/VRCNT_4.2.0_x64-setup.exe"
            ),
        )

    def test_release_manifests_and_readme_are_version_4_2_0(self):
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

        self.assertEqual(package["version"], "4.2.0")
        self.assertEqual(tauri_config["version"], "4.2.0")
        self.assertIn("badge/version-4.2.0-", readme)


if __name__ == "__main__":
    unittest.main()
