import os
import json
import re

from release_config import build_release_urls, load_release_config


def replace_in_file(path, replacements):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    for pattern, replacement, count in replacements:
        content = re.sub(pattern, replacement, content, count=count)

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def update_readme_versions(root, version):
    readme_paths = (
        os.path.join(root, "README.md"),
        os.path.join(root, "Readme", "Readme.en.md"),
        os.path.join(root, "Readme", "Readme.jp.md"),
        os.path.join(root, "Readme", "Readme.kr.md"),
        os.path.join(root, "Readme", "Readme.scn.md"),
        os.path.join(root, "Readme", "Readme.tcn.md"),
        os.path.join(root, "Readme", "Readme.th.md"),
    )
    replacements = [
        (
            r'(badge/version-)[0-9]+\.[0-9]+\.[0-9]+(-)',
            rf'\g<1>{version}\g<2>',
            1,
        ),
        (
            r'(VRCNT_)[0-9]+\.[0-9]+\.[0-9]+(_x64-setup\.exe)',
            rf'\g<1>{version}\g<2>',
            1,
        ),
    ]
    for readme_path in readme_paths:
        replace_in_file(readme_path, replacements)

def update_versions():
    root = os.path.join(os.path.dirname(os.path.dirname(__file__)))

    # package.jsonからバージョンを読み取る
    with open(os.path.join(root, "package.json"), "r", encoding="utf-8") as f:
        package_json = json.load(f)
        version = package_json["version"]

    package_lock_path = os.path.join(root, "package-lock.json")
    if os.path.exists(package_lock_path):
        with open(package_lock_path, "r", encoding="utf-8") as f:
            package_lock = json.load(f)
        package_lock["version"] = version
        if isinstance(package_lock.get("packages"), dict) and isinstance(package_lock["packages"].get(""), dict):
            package_lock["packages"][""]["version"] = version
        with open(package_lock_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(package_lock, f, indent=2, ensure_ascii=False)
            f.write("\n")

    release_config = load_release_config(root)
    release_urls = build_release_urls(release_config, version)

    # tauri.conf.jsonを更新
    tauri_conf_path = os.path.join(root, "src-tauri", "tauri.conf.json")
    with open(tauri_conf_path, "r", encoding="utf-8") as f:
        tauri_conf = json.load(f)

    tauri_conf["version"] = version
    tauri_conf.setdefault("plugins", {}).setdefault("updater", {})["endpoints"] = (
        [release_urls.latest_json_url] if release_urls.latest_json_url else []
    )

    with open(tauri_conf_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(tauri_conf, f, indent=4, ensure_ascii=False)

    # config.pyを更新
    replace_in_file(
        os.path.join(root, "src-python", "config.py"),
        [
            (r'(self\._VERSION = ")[^"]+(")', rf'\g<1>{version}\g<2>', 1),
            (r'(self\._GITHUB_URL = ")[^"]*(")', rf'\g<1>{release_urls.raw_package_json_url}\g<2>', 1),
            (r'(self\._UPDATER_URL = ")[^"]*(")', rf'\g<1>{release_urls.release_url}\g<2>', 1),
            (r'(self\._LATEST_JSON_URL = ")[^"]*(")', rf'\g<1>{release_urls.latest_json_url}\g<2>', 1),
        ]
    )

    # Cargo package version
    replace_in_file(
        os.path.join(root, "src-tauri", "Cargo.toml"),
        [(r'(\[package\][\s\S]*?version = ")[^"]+(")', rf'\g<1>{version}\g<2>', 1)]
    )

    cargo_lock_path = os.path.join(root, "src-tauri", "Cargo.lock")
    if os.path.exists(cargo_lock_path):
        replace_in_file(
            cargo_lock_path,
            [(r'(\[\[package\]\]\nname = "vrcnt"\nversion = ")[^"]+(")', rf'\g<1>{version}\g<2>', 1)]
        )

    update_readme_versions(root, version)

    replace_in_file(
        os.path.join(root, "src-ui", "logics", "store.js"),
        [
            (r'(createAtomWithHook\(")[^"]+(", "SoftwareVersion"\))', rf'\g<1>{version}\g<2>', 1)
        ]
    )

    nsis_release_base = (
        f"https://github.com/{release_config.github_owner}/{release_config.github_repo}/releases/download/v${{VERSION}}"
        if not release_config.has_placeholders else ""
    )
    replace_in_file(
        os.path.join(root, "src-tauri", "nsis", "template.nsi"),
        [
            (r'(!define SOFTWARE_RELEASE_URL ")[^"]*(")', rf'\g<1>{nsis_release_base}\g<2>', 1),
            (
                r'(!define PACKAGE_MANIFEST_NAME ")[^"]*(")',
                rf'\g<1>{release_config.package_manifest_asset_name}\g<2>',
                1,
            ),
            (
                r'(!define PACKAGE_PART_COUNT )[0-9]+',
                rf'\g<1>{release_config.package_part_count}',
                1,
            ),
        ]
    )

    replace_in_file(
        os.path.join(root, ".github", "workflows", "release.yml"),
        [(r'(e\.g\. v|for example, v)[0-9]+\.[0-9]+\.[0-9]+(\))', rf'\g<1>{version}\g<2>', 0)]
    )

    telemetry_paths = [
        os.path.join(root, "src-python", "models", "telemetry", "__init__.py"),
        os.path.join(root, "src-python", "models", "telemetry", "core.py"),
        os.path.join(root, "src-python", "models", "telemetry", "client.py"),
    ]
    for path in telemetry_paths:
        replace_in_file(
            path,
            [(r'(?<![0-9])[0-9]+\.[0-9]+\.[0-9]+(?![0-9])', version, 0)]
        )

    print(f"updated to version {version}")

if __name__ == "__main__":
    update_versions()
