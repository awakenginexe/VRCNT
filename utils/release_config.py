from dataclasses import dataclass
import json
import os
from string import Template


PLACEHOLDER_OWNER = "OWNER_TODO"
PLACEHOLDER_REPO = "REPO_TODO"


@dataclass(frozen=True)
class ReleaseConfig:
    github_owner: str
    github_repo: str
    package_name_pattern: str
    package_part_count: int
    max_asset_size_bytes: int
    package_manifest_asset_name: str
    hashes_asset_name: str
    latest_json_asset_name: str
    installer_name_pattern: str

    @classmethod
    def placeholder(cls):
        return cls(
            github_owner=PLACEHOLDER_OWNER,
            github_repo=PLACEHOLDER_REPO,
            package_name_pattern="VRCNT_${version}.7z",
            package_part_count=3,
            max_asset_size_bytes=2_000_000_000,
            package_manifest_asset_name="package-manifest.json",
            hashes_asset_name="SHA256SUMS.txt",
            latest_json_asset_name="latest.json",
            installer_name_pattern="VRCNT_${version}_x64-setup.exe",
        )

    @property
    def has_placeholders(self):
        return self.github_owner in ("", PLACEHOLDER_OWNER) or self.github_repo in (
            "",
            PLACEHOLDER_REPO,
        )

    def package_name(self, version):
        return Template(self.package_name_pattern).safe_substitute(version=str(version).lstrip("v"))

    def installer_name(self, version):
        return Template(self.installer_name_pattern).safe_substitute(version=str(version).lstrip("v"))

    def release_download_url(self, version, asset_name):
        version = str(version).strip().lstrip("v")
        return (
            f"https://github.com/{self.github_owner}/{self.github_repo}/releases/"
            f"download/v{version}/{asset_name}"
        )


@dataclass(frozen=True)
class ReleaseUrls:
    release_url: str
    latest_json_url: str
    installer_url: str
    raw_package_json_url: str
    has_placeholders: bool


def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_release_config(root=None):
    root = root or _repo_root()
    config_path = os.path.join(root, "release.config.json")
    fallback = ReleaseConfig.placeholder()
    try:
        with open(config_path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except Exception:
        return fallback

    return ReleaseConfig(
        github_owner=str(data.get("githubOwner", fallback.github_owner)).strip(),
        github_repo=str(data.get("githubRepo", fallback.github_repo)).strip(),
        package_name_pattern=str(data.get("packageNamePattern", fallback.package_name_pattern)).strip(),
        package_part_count=int(data.get("packagePartCount", fallback.package_part_count)),
        max_asset_size_bytes=int(data.get("maxAssetSizeBytes", fallback.max_asset_size_bytes)),
        package_manifest_asset_name=str(
            data.get("packageManifestAssetName", fallback.package_manifest_asset_name)
        ).strip(),
        hashes_asset_name=str(data.get("hashesAssetName", fallback.hashes_asset_name)).strip(),
        latest_json_asset_name=str(
            data.get("latestJsonAssetName", fallback.latest_json_asset_name)
        ).strip(),
        installer_name_pattern=str(
            data.get("installerNamePattern", fallback.installer_name_pattern)
        ).strip(),
    )


def build_release_urls(config, version):
    if config.has_placeholders:
        return ReleaseUrls("", "", "", "", True)

    version = str(version).strip().lstrip("v")
    return ReleaseUrls(
        release_url=f"https://github.com/{config.github_owner}/{config.github_repo}/releases",
        latest_json_url=(
            f"https://github.com/{config.github_owner}/{config.github_repo}/releases/"
            f"latest/download/{config.latest_json_asset_name}"
        ),
        installer_url=config.release_download_url(version, config.installer_name(version)),
        raw_package_json_url=(
            f"https://raw.githubusercontent.com/{config.github_owner}/{config.github_repo}/main/package.json"
        ),
        has_placeholders=False,
    )
