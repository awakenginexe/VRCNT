#!/usr/bin/env python3
"""Build the self-contained installer localization catalog from VRCNT locales."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REQUIRED_INSTALLER_KEYS = frozenset(
    {
        "app_name", "welcome_title", "welcome_body", "continue", "back",
        "language_title", "language_body", "runtime_title", "runtime_body",
        "cpu_title", "cpu_body", "cpu_size", "cpu_time", "cuda_title",
        "cuda_body", "cuda_size", "cuda_time", "recommended", "compatible",
        "not_detected", "install_size", "install_time", "options_title",
        "options_body", "launch_vrcnt", "install", "progress_title",
        "progress_body", "error_title", "error_body", "retry", "complete_title",
        "complete_body", "close",
    }
)


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def _read_installer_namespace(path: Path) -> dict[str, str]:
    """Read the scalar-only installer mapping without making PyYAML a build dependency."""
    installer: dict[str, str] = {}
    in_installer_namespace = False
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if raw_line == "installer:":
            in_installer_namespace = True
            continue
        if in_installer_namespace and raw_line and not raw_line.startswith((" ", "\t")):
            break
        if not in_installer_namespace or not raw_line.startswith("    ") or ":" not in raw_line:
            continue
        key, raw_value = raw_line.strip().split(":", 1)
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = json.loads(value)
        installer[key] = value
    if not in_installer_namespace:
        raise ValueError(f"{path.name} requires an installer namespace")
    return installer


def build_catalog(locales_dir: Path) -> dict[str, Any]:
    language_catalog_path = locales_dir / "languages.json"
    languages = _read_json(language_catalog_path)
    if not isinstance(languages, list) or not languages:
        raise ValueError("languages.json must contain a non-empty language list")

    identifiers: list[str] = []
    catalog_languages: list[dict[str, str]] = []
    translations: dict[str, dict[str, str]] = {}
    for language in languages:
        if not isinstance(language, dict):
            raise ValueError("languages.json entries must be objects")
        language_id = language.get("id")
        label = language.get("label")
        if not isinstance(language_id, str) or not language_id or not isinstance(label, str) or not label:
            raise ValueError("languages.json entries require non-empty id and label values")
        if language_id in identifiers:
            raise ValueError(f"languages.json contains a duplicate language id: {language_id}")
        identifiers.append(language_id)
        installer = _read_installer_namespace(locales_dir / f"{language_id}.yml")
        keys = set(installer)
        if keys != REQUIRED_INSTALLER_KEYS:
            missing = sorted(REQUIRED_INSTALLER_KEYS - keys)
            unexpected = sorted(keys - REQUIRED_INSTALLER_KEYS)
            details = []
            if missing:
                details.append(f"missing {', '.join(missing)}")
            if unexpected:
                details.append(f"unexpected {', '.join(unexpected)}")
            raise ValueError(f"{language_id}.yml installer namespace is incomplete: {'; '.join(details)}")
        if not all(isinstance(value, str) and value.strip() for value in installer.values()):
            raise ValueError(f"{language_id}.yml installer namespace contains an empty translation")
        catalog_languages.append({"id": language_id, "name": label})
        translations[language_id] = {key: installer[key] for key in sorted(REQUIRED_INSTALLER_KEYS)}

    return {"version": 1, "languages": catalog_languages, "translations": translations}


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--locales-dir", type=Path, default=root / "locales")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        catalog = build_catalog(args.locales_dir)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"installer locale generation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
