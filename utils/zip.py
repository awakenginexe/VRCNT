import argparse
from pathlib import Path
import time
import zipfile

from release_config import load_release_config

try:
    from tqdm import tqdm
except ModuleNotFoundError:
    def tqdm(iterable, **_kwargs):
        return iterable


DEFAULT_RELEASE_FILES = [
    "src-tauri/target/release/vrcnt.exe",
    "src-tauri/target/release/VRCT-sidecar.exe",
]
DEFAULT_RELEASE_DIRECTORIES = [
    "src-tauri/target/release/_internal",
    "src-tauri/target/release/frontend",
]


def _validated_payload_paths(file_paths, dir_paths):
    files = [Path(path) for path in file_paths]
    directories = [Path(path) for path in dir_paths]
    missing = [
        str(path)
        for path in files
        if not path.is_file()
    ]
    missing.extend(
        str(path)
        for path in directories
        if not path.is_dir()
    )
    if missing:
        formatted_paths = "\n- ".join(missing)
        raise FileNotFoundError(
            f"Required VRCNT release payload is missing:\n- {formatted_paths}"
        )
    return files, directories


def zip_files_and_directory(zip_name, file_paths, dir_paths, verbose=False):
    zip_file_path = Path(zip_name)
    files, directories = _validated_payload_paths(file_paths, dir_paths)
    temporary_zip_path = zip_file_path.with_suffix(f"{zip_file_path.suffix}.tmp")

    if temporary_zip_path.exists():
        temporary_zip_path.unlink()

    try:
        with zipfile.ZipFile(
            temporary_zip_path,
            "w",
            zipfile.ZIP_DEFLATED,
        ) as archive:
            for file_path in tqdm(files, desc="Adding files", unit="file"):
                archive.write(file_path, file_path.name)
                if verbose:
                    print(f"Add file: {file_path}")

            for directory in directories:
                all_files = [
                    item
                    for item in directory.rglob("*")
                    if item.is_file()
                ]
                for item in tqdm(
                    all_files,
                    desc=f"Adding files from {directory.name}",
                    unit="file",
                ):
                    archive_name = Path(directory.name) / item.relative_to(directory)
                    archive.write(item, archive_name)
                    if verbose:
                        print(f"Add file: {item}")

        temporary_zip_path.replace(zip_file_path)
    except Exception:
        if temporary_zip_path.exists():
            temporary_zip_path.unlink()
        raise

    print(f"Successfully created zip file: {zip_file_path}")
    return zip_file_path


if __name__ == "__main__":
    start_time = time.time()
    release_config = load_release_config()
    parser = argparse.ArgumentParser(description="Create a zip file from specified files and directories.")
    parser.add_argument(
        "--zip_name",
        type=str,
        default=release_config.release_asset_zip_name,
        help="Name of the output zip file.",
    )
    parser.add_argument(
        "--file_paths",
        type=str,
        nargs="*",
        default=DEFAULT_RELEASE_FILES,
        help="List of file paths to include in the zip."
    )
    parser.add_argument(
        "--dir_paths",
        type=str,
        nargs="*",
        default=DEFAULT_RELEASE_DIRECTORIES,
        help="List of directory paths to include in the zip."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Increase output verbosity."
    )
    args = parser.parse_args()

    zip_files_and_directory(args.zip_name, args.file_paths, args.dir_paths, args.verbose)
    end_time = time.time()
    processing_time = end_time - start_time
    print(f"Complete! Processing time: {processing_time:.2f} seconds")
