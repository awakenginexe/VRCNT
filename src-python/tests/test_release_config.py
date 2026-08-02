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
            f"download/v{version}/VRCNT_{version}_x64-setup.exe",
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


if __name__ == "__main__":
    unittest.main()
