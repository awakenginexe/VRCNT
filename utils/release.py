"""Build and validate VRCNT GitHub Release metadata and variant payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
from typing import Iterable

from release_config import load_release_config


REQUIRED_PAYLOAD_FILES = ("VRCNT.exe", "VRCNT-backend.exe", "VRCNT.runtime.json")
REQUIRED_PAYLOAD_DIRECTORIES = ("_internal", "frontend")
VARIANTS = {"cpu", "cuda"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(16 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_payload(source_dir: Path) -> None:
    missing = [str(source_dir / name) for name in REQUIRED_PAYLOAD_FILES if not (source_dir / name).is_file()]
    missing.extend(str(source_dir / name) for name in REQUIRED_PAYLOAD_DIRECTORIES if not (source_dir / name).is_dir())
    if missing:
        raise FileNotFoundError("Required VRCNT release payload is missing:\n- " + "\n- ".join(missing))


def normalized_variant(value: str) -> str:
    variant = str(value).strip().lower()
    if variant not in VARIANTS:
        raise ValueError(f"Unsupported runtime package variant: {value}")
    return variant


def create_archive(seven_zip: Path, source_dir: Path, archive: Path) -> None:
    validate_payload(source_dir)
    if not seven_zip.is_file():
        raise FileNotFoundError(f"7za.exe was not found at {seven_zip}")
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.unlink(missing_ok=True)
    command = [
        str(seven_zip), "a", "-t7z", "-mx=9", "-mmt=on", "-y", str(archive.resolve()),
        *REQUIRED_PAYLOAD_FILES, *REQUIRED_PAYLOAD_DIRECTORIES,
    ]
    subprocess.run(command, check=True, cwd=source_dir)
    if not archive.is_file() or archive.stat().st_size < 3:
        raise RuntimeError("7za.exe did not generate a valid portable archive.")


def split_to_asset_limit(archive: str | Path, max_asset_size: int) -> list[Path]:
    archive = Path(archive)
    if max_asset_size <= 1:
        raise ValueError("max_asset_size must leave room for a non-empty part below the asset limit.")
    total_size = archive.stat().st_size
    if total_size <= 0:
        raise RuntimeError("The archive is empty.")
    part_limit = max_asset_size - 1
    part_count = math.ceil(total_size / part_limit)
    part_size = math.ceil(total_size / part_count)
    parts = [Path(f"{archive}.{index:03d}") for index in range(1, part_count + 1)]
    for part in parts:
        part.unlink(missing_ok=True)
    try:
        with archive.open("rb") as source:
            for part in parts:
                remaining = min(part_size, total_size - source.tell())
                if remaining <= 0:
                    raise RuntimeError("Archive split created an empty package part.")
                with part.open("wb") as destination:
                    while remaining:
                        chunk = source.read(min(16 * 1024 * 1024, remaining))
                        if not chunk:
                            raise EOFError("Unexpected end of archive while creating multipart files.")
                        destination.write(chunk)
                        remaining -= len(chunk)
            if source.tell() != total_size:
                raise RuntimeError("Multipart split did not consume the complete archive.")
    except Exception:
        for part in parts:
            part.unlink(missing_ok=True)
        raise
    finally:
        archive.unlink(missing_ok=True)
    return parts


def _part_entries(parts: Iterable[Path]) -> list[dict[str, object]]:
    return [{"name": part.name, "size": part.stat().st_size, "sha256": sha256_file(part)} for part in parts]


def _load_runtime_identity(source_dir: Path, version: str, variant: str) -> dict[str, str]:
    try:
        identity = json.loads((source_dir / "VRCNT.runtime.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("VRCNT.runtime.json must contain a valid runtime identity.") from error
    required = ("product", "version", "variant", "architecture", "buildIdentity")
    if any(not isinstance(identity.get(key), str) or not identity[key].strip() for key in required):
        raise ValueError("VRCNT.runtime.json is missing a required runtime identity field.")
    if identity["product"] != "VRCNT" or identity["version"] != version or identity["variant"].lower() != variant or identity["architecture"] != "x64":
        raise ValueError("VRCNT.runtime.json does not match the package variant identity.")
    return {
        "product": identity["product"], "version": identity["version"], "variant": variant.title(),
        "architecture": identity["architecture"], "buildIdentity": identity["buildIdentity"],
        "markerSha256": sha256_file(source_dir / "VRCNT.runtime.json"),
    }


def _installed_size(source_dir: Path) -> int:
    return sum(path.stat().st_size for path in source_dir.rglob("*") if path.is_file())


def write_variant_metadata(version: str, variant: str, source_dir: Path, parts: Iterable[Path], destination: Path) -> dict:
    variant = normalized_variant(variant)
    part_entries = _part_entries(parts)
    if not part_entries:
        raise ValueError("A variant package must include at least one archive part.")
    metadata = {
        "variant": variant,
        "archiveFormat": "7z",
        "compressedSize": sum(int(part["size"]) for part in part_entries),
        "installedSize": _installed_size(source_dir),
        "parts": part_entries,
        "requiresNvidia": variant == "cuda",
        "markerPath": "VRCNT.runtime.json",
        "identity": _load_runtime_identity(source_dir, version, variant),
    }
    destination.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return metadata


def _safe_asset_name(name: object) -> bool:
    return isinstance(name, str) and bool(name) and Path(name).name == name and ".." not in name and "/" not in name and "\\" not in name


def _load_variant_metadata(version: str, variant: str, directory: Path) -> dict:
    variant = normalized_variant(variant)
    metadata_path = directory / "package-metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{metadata_path} must contain valid package metadata.") from error
    if not isinstance(metadata, dict) or metadata.get("variant") != variant or metadata.get("archiveFormat") != "7z":
        raise ValueError(f"{metadata_path} does not describe the requested {variant} package.")
    parts = metadata.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ValueError(f"{metadata_path} has no package parts.")
    checked_parts = []
    for part in parts:
        if not isinstance(part, dict) or not _safe_asset_name(part.get("name")) or not isinstance(part.get("size"), int) or part["size"] <= 0 or not isinstance(part.get("sha256"), str) or len(part["sha256"]) != 64:
            raise ValueError(f"{metadata_path} has an invalid package part record.")
        path = directory / part["name"]
        if not path.is_file() or path.stat().st_size != part["size"] or sha256_file(path) != part["sha256"].lower():
            raise ValueError(f"{metadata_path} package part {part['name']} does not match its recorded hash.")
        checked_parts.append({"name": part["name"], "size": part["size"], "sha256": part["sha256"].lower()})
    if metadata.get("compressedSize") != sum(part["size"] for part in checked_parts) or not isinstance(metadata.get("installedSize"), int) or metadata["installedSize"] <= 0:
        raise ValueError(f"{metadata_path} has invalid package size metadata.")
    identity = metadata.get("identity")
    if not isinstance(identity, dict) or identity.get("product") != "VRCNT" or identity.get("version") != version or identity.get("variant") != variant.title() or identity.get("architecture") != "x64" or not isinstance(identity.get("buildIdentity"), str) or not identity["buildIdentity"] or not isinstance(identity.get("markerSha256"), str) or len(identity["markerSha256"]) != 64:
        raise ValueError(f"{metadata_path} has an invalid runtime identity.")
    return {
        "archiveFormat": "7z", "compressedSize": metadata["compressedSize"], "installedSize": metadata["installedSize"],
        "parts": checked_parts, "requiresNvidia": variant == "cuda", "markerPath": "VRCNT.runtime.json", "identity": identity,
    }


def write_combined_manifest(version: str, cpu_dir: str | Path, cuda_dir: str | Path, setup: str | Path, destination: str | Path) -> dict:
    setup = Path(setup)
    destination = Path(destination)
    expected_setup_name = f"VRCNT_{version}_Setup.exe"
    if setup.name != expected_setup_name or not setup.is_file() or setup.stat().st_size <= 0:
        raise ValueError(f"The setup bootstrapper must be the non-empty {expected_setup_name} file.")
    manifest = {
        "schema": 2, "product": "VRCNT", "version": version, "architecture": "x64",
        "bootstrapper": {"name": setup.name, "size": setup.stat().st_size, "sha256": sha256_file(setup), "managerProtocol": 1, "manifestSchema": 2, "runtimeStateSchema": 1, "activationProtocol": 1},
        "variants": {"cpu": _load_variant_metadata(version, "cpu", Path(cpu_dir)), "cuda": _load_variant_metadata(version, "cuda", Path(cuda_dir))},
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return manifest


def package(version: str, variant: str, source_dir: Path, seven_zip: Path, output_dir: Path) -> dict:
    config = load_release_config()
    variant = normalized_variant(variant)
    archive = output_dir / config.package_name(version, variant)
    create_archive(seven_zip, source_dir, archive)
    parts = split_to_asset_limit(archive, config.max_asset_size_bytes)
    metadata = write_variant_metadata(version, variant, source_dir, parts, output_dir / "package-metadata.json")
    for item in metadata["parts"]:
        print(f"Created {item['name']} ({item['size']} bytes, SHA-256 {item['sha256']})")
    return metadata


def latest(version: str, updater_name: str, signature_path: Path, output_path: Path, pub_date: str, release_tag: str | None = None) -> None:
    config = load_release_config()
    signature = signature_path.read_text(encoding="utf-8-sig").strip()
    if not signature:
        raise ValueError("Tauri updater signature is empty.")
    document = {"version": version, "notes": f"VRCNT {version}: GitHub Releases installer and updater migration.", "pub_date": pub_date, "platforms": {"windows-x86_64": {"signature": signature, "url": config.release_download_url(version, updater_name, release_tag)}}}
    output_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def hashes(paths: Iterable[Path], destination: Path) -> None:
    files = sorted((path for path in paths if path.is_file()), key=lambda path: path.name)
    if not files:
        raise FileNotFoundError("No release assets were provided for SHA256SUMS.txt.")
    destination.write_text("\n".join(f"{sha256_file(path)}  {path.name}" for path in files) + "\n", encoding="utf-8", newline="\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    package_parser = subparsers.add_parser("package")
    package_parser.add_argument("--version", required=True)
    package_parser.add_argument("--variant", choices=sorted(VARIANTS), required=True)
    package_parser.add_argument("--source-dir", type=Path, required=True)
    package_parser.add_argument("--seven-zip", type=Path, required=True)
    package_parser.add_argument("--output-dir", type=Path, required=True)
    manifest_parser = subparsers.add_parser("manifest")
    manifest_parser.add_argument("--version", required=True)
    manifest_parser.add_argument("--cpu-dir", type=Path, required=True)
    manifest_parser.add_argument("--cuda-dir", type=Path, required=True)
    manifest_parser.add_argument("--setup", type=Path, required=True)
    manifest_parser.add_argument("--output", type=Path, required=True)
    latest_parser = subparsers.add_parser("latest")
    latest_parser.add_argument("--version", required=True)
    latest_parser.add_argument("--updater-name", required=True)
    latest_parser.add_argument("--signature", type=Path, required=True)
    latest_parser.add_argument("--output", type=Path, required=True)
    latest_parser.add_argument("--pub-date", required=True)
    latest_parser.add_argument("--release-tag")
    hashes_parser = subparsers.add_parser("hashes")
    hashes_parser.add_argument("--output", type=Path, required=True)
    hashes_parser.add_argument("paths", type=Path, nargs="+")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "package":
        args.output_dir.mkdir(parents=True, exist_ok=True)
        package(args.version, args.variant, args.source_dir, args.seven_zip, args.output_dir)
    elif args.command == "manifest":
        write_combined_manifest(args.version, args.cpu_dir, args.cuda_dir, args.setup, args.output)
    elif args.command == "latest":
        latest(args.version, args.updater_name, args.signature, args.output, args.pub_date, args.release_tag)
    elif args.command == "hashes":
        hashes(args.paths, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
