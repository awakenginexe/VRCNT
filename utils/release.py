"""Build and validate VRCNT GitHub Release metadata and multipart payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Iterable

from release_config import load_release_config


DEFAULT_RELEASE_FILES = (
    Path("src-tauri/target/release/VRCNT.exe"),
    Path("src-tauri/target/release/VRCNT-backend.exe"),
)
DEFAULT_RELEASE_DIRECTORIES = (
    Path("src-tauri/target/release/_internal"),
    Path("src-tauri/target/release/frontend"),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(16 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_payload(files: Iterable[Path], directories: Iterable[Path]) -> None:
    missing = [str(path) for path in files if not path.is_file()]
    missing.extend(str(path) for path in directories if not path.is_dir())
    if missing:
        raise FileNotFoundError(
            "Required VRCNT release payload is missing:\n- " + "\n- ".join(missing)
        )


def create_archive(seven_zip: Path, archive: Path) -> None:
    validate_payload(DEFAULT_RELEASE_FILES, DEFAULT_RELEASE_DIRECTORIES)
    if not seven_zip.is_file():
        raise FileNotFoundError(f"7za.exe was not found at {seven_zip}")
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.unlink(missing_ok=True)
    release_directory = DEFAULT_RELEASE_FILES[0].parent
    command = [
        str(seven_zip),
        "a",
        "-t7z",
        "-mx=9",
        "-mmt=on",
        "-y",
        str(archive.resolve()),
        *(path.name for path in DEFAULT_RELEASE_FILES),
        *(path.name for path in DEFAULT_RELEASE_DIRECTORIES),
    ]
    subprocess.run(command, check=True, cwd=release_directory)
    if not archive.is_file() or archive.stat().st_size < 3:
        raise RuntimeError("7za.exe did not generate a valid portable archive.")


def split_exactly(archive: Path, part_count: int, max_asset_size: int) -> list[Path]:
    total_size = archive.stat().st_size
    part_size = math.ceil(total_size / part_count)
    if part_size >= max_asset_size:
        raise RuntimeError(
            f"The {total_size}-byte archive cannot fit in {part_count} parts below "
            f"the configured {max_asset_size}-byte asset limit."
        )

    parts = [Path(f"{archive}.{index:03d}") for index in range(1, part_count + 1)]
    for part in parts:
        part.unlink(missing_ok=True)

    try:
        final_position = 0
        with archive.open("rb") as source:
            for part in parts:
                remaining = min(part_size, total_size - source.tell())
                if remaining <= 0:
                    raise RuntimeError("Archive was too small to create every required part.")
                with part.open("wb") as destination:
                    while remaining:
                        chunk = source.read(min(16 * 1024 * 1024, remaining))
                        if not chunk:
                            raise EOFError("Unexpected end of archive while creating multipart files.")
                        destination.write(chunk)
                        remaining -= len(chunk)
            final_position = source.tell()
        if final_position != total_size:
            raise RuntimeError("Multipart split did not consume the complete archive.")
    except Exception:
        for part in parts:
            part.unlink(missing_ok=True)
        raise
    finally:
        archive.unlink(missing_ok=True)
    return parts


def write_manifest(version: str, parts: Iterable[Path], destination: Path) -> dict:
    part_entries = []
    for part in parts:
        size = part.stat().st_size
        part_entries.append(
            {"name": part.name, "size": size, "sha256": sha256_file(part)}
        )
    manifest = {
        "schema": 1,
        "product": "VRCNT",
        "version": version,
        "archive_format": "7z-split",
        "files": part_entries,
    }
    destination.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def package(version: str, seven_zip: Path, output_dir: Path) -> None:
    config = load_release_config()
    archive_name = config.package_name(version)
    archive = output_dir / archive_name
    create_archive(seven_zip, archive)
    parts = split_exactly(archive, config.package_part_count, config.max_asset_size_bytes)
    manifest_path = output_dir / config.package_manifest_asset_name
    manifest = write_manifest(version, parts, manifest_path)
    for item in manifest["files"]:
        print(f"Created {item['name']} ({item['size']} bytes, SHA-256 {item['sha256']})")
    print(f"Created unsigned manifest {manifest_path}; it must be signed before publishing.")


def latest(
    version: str,
    updater_name: str,
    signature_path: Path,
    output_path: Path,
    pub_date: str,
) -> None:
    config = load_release_config()
    signature = signature_path.read_text(encoding="utf-8-sig").strip()
    if not signature:
        raise ValueError("Tauri updater signature is empty.")
    document = {
        "version": version,
        "notes": f"VRCNT {version}: GitHub Releases installer and updater migration.",
        "pub_date": pub_date,
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": config.release_download_url(version, updater_name),
            }
        },
    }
    output_path.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def hashes(paths: Iterable[Path], destination: Path) -> None:
    files = sorted((path for path in paths if path.is_file()), key=lambda path: path.name)
    if not files:
        raise FileNotFoundError("No release assets were provided for SHA256SUMS.txt.")
    lines = [f"{sha256_file(path)}  {path.name}" for path in files]
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    package_parser = subparsers.add_parser("package")
    package_parser.add_argument("--version", required=True)
    package_parser.add_argument("--seven-zip", type=Path, required=True)
    package_parser.add_argument("--output-dir", type=Path, default=Path("release-assets"))

    latest_parser = subparsers.add_parser("latest")
    latest_parser.add_argument("--version", required=True)
    latest_parser.add_argument("--updater-name", required=True)
    latest_parser.add_argument("--signature", type=Path, required=True)
    latest_parser.add_argument("--output", type=Path, required=True)
    latest_parser.add_argument("--pub-date", required=True)

    hashes_parser = subparsers.add_parser("hashes")
    hashes_parser.add_argument("--output", type=Path, required=True)
    hashes_parser.add_argument("paths", type=Path, nargs="+")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "package":
        args.output_dir.mkdir(parents=True, exist_ok=True)
        package(args.version, args.seven_zip, args.output_dir)
    elif args.command == "latest":
        latest(
            args.version,
            args.updater_name,
            args.signature,
            args.output,
            args.pub_date,
        )
    elif args.command == "hashes":
        hashes(args.paths, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
