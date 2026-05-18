import os
import json
import re


def replace_in_file(path, replacements):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    for pattern, replacement, count in replacements:
        content = re.sub(pattern, replacement, content, count=count)

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)

def update_versions():
    root = os.path.join(os.path.dirname(os.path.dirname(__file__)))

    # package.jsonからバージョンを読み取る
    with open(os.path.join(root, "package.json"), "r", encoding="utf-8") as f:
        package_json = json.load(f)
        version = package_json["version"]

    # tauri.conf.jsonを更新
    tauri_conf_path = os.path.join(root, "src-tauri", "tauri.conf.json")
    with open(tauri_conf_path, "r", encoding="utf-8") as f:
        tauri_conf = json.load(f)

    tauri_conf["version"] = version

    with open(tauri_conf_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(tauri_conf, f, indent=4, ensure_ascii=False)

    # config.pyを更新
    replace_in_file(
        os.path.join(root, "src-python", "config.py"),
        [(r'(self\._VERSION = ")[^"]+(")', rf'\g<1>{version}\g<2>', 1)]
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
            [(r'(\[\[package\]\]\nname = "VRCNT"\nversion = ")[^"]+(")', rf'\g<1>{version}\g<2>', 1)]
        )

    replace_in_file(
        os.path.join(root, "README.md"),
        [
            (r'(badge/version-)[^-]+(-20d6ff)', rf'\g<1>{version}\g<2>', 1),
            (r'(VRCNT_)[0-9]+\.[0-9]+\.[0-9]+(_x64-setup\.exe)', rf'\g<1>{version}\g<2>', 1),
        ]
    )

    replace_in_file(
        os.path.join(root, ".github", "workflows", "release.yml"),
        [(r'(e\.g\. v)[0-9]+\.[0-9]+\.[0-9]+(\))', rf'\g<1>{version}\g<2>', 1)]
    )

    telemetry_paths = [
        os.path.join(root, "src-python", "models", "telemetry", "__init__.py"),
        os.path.join(root, "src-python", "models", "telemetry", "core.py"),
        os.path.join(root, "src-python", "models", "telemetry", "client.py"),
        os.path.join(root, "src-python", "docs", "telemetry_design.md"),
        os.path.join(root, "src-python", "docs", "mainloop.md"),
    ]
    for path in telemetry_paths:
        replace_in_file(
            path,
            [(r'(?<![0-9])1\.0\.[0-9]+(?![0-9])', version, 0)]
        )

    print(f"updated to version {version}")

if __name__ == "__main__":
    update_versions()
