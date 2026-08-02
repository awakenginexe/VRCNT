"""Verified, script-aware font resolution for Pillow-based VR overlays."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from os import path as os_path
from typing import Iterable, Optional


@dataclass(frozen=True)
class FontRun:
    text: str
    pack_id: Optional[str]
    font_path: Optional[str]
    uses_system_fallback: bool


class ManagedOverlayFontRegistry:
    """Uses only manifest-verified bundled or cache-installed fonts; never downloads."""

    def __init__(self, bundled_root: str, cache_root: Optional[str] = None) -> None:
        self.bundled_root = os_path.abspath(bundled_root)
        with open(os_path.join(self.bundled_root, "font-packs.v1.json"), encoding="utf-8") as handle:
            self.manifest = json.load(handle)
        self.cache_root = cache_root if cache_root is not None else self._default_cache_root()
        self._verified_paths: dict[str, Optional[str]] = {}

    @staticmethod
    def _default_cache_root() -> str:
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.environ.get("USERPROFILE") or "."
        current = os_path.join(base, "VRCNTData", "fonts")
        legacy = os_path.join(base, "VRCNT-NextData", "fonts")
        return current if os_path.exists(current) or not os_path.exists(legacy) else legacy

    @staticmethod
    def _script_pack(character: str) -> str:
        point = ord(character)
        if 0x0E00 <= point <= 0x0E7F:
            return "thai"
        if 0x3040 <= point <= 0x30FF or 0x31F0 <= point <= 0x31FF:
            return "japanese"
        if 0xAC00 <= point <= 0xD7AF or 0x1100 <= point <= 0x11FF:
            return "korean"
        if 0x0E80 <= point <= 0x0EFF:
            return "lao"
        if 0x1780 <= point <= 0x17FF:
            return "khmer"
        if 0x1000 <= point <= 0x109F:
            return "myanmar"
        if 0x0900 <= point <= 0x097F:
            return "devanagari"
        if 0x0600 <= point <= 0x06FF or 0x0750 <= point <= 0x077F:
            return "arabic"
        if 0x1200 <= point <= 0x137F:
            return "ethiopic"
        if 0x0530 <= point <= 0x058F:
            return "armenian"
        if 0x0980 <= point <= 0x09FF:
            return "bengali"
        if 0x10A0 <= point <= 0x10FF:
            return "georgian"
        if 0x0A80 <= point <= 0x0AFF:
            return "gujarati"
        if 0x0590 <= point <= 0x05FF:
            return "hebrew"
        if 0x0C80 <= point <= 0x0CFF:
            return "kannada"
        if 0x0D00 <= point <= 0x0D7F:
            return "malayalam"
        if 0x0D80 <= point <= 0x0DFF:
            return "sinhala"
        if 0x0B80 <= point <= 0x0BFF:
            return "tamil"
        if 0x0C00 <= point <= 0x0C7F:
            return "telugu"
        if 0x4E00 <= point <= 0x9FFF or 0x3400 <= point <= 0x4DBF:
            return "cjk-traditional" if character in "繁體國臺萬與" else "cjk-simplified"
        return "latin-greek-cyrillic"

    @staticmethod
    def _is_japanese_context(character: str) -> bool:
        point = ord(character)
        return 0x3040 <= point <= 0x30FF or 0x31F0 <= point <= 0x31FF

    def _pack_for_character(self, text: str, index: int, language: Optional[str] = None) -> str:
        character = text[index]
        pack_id = self._script_pack(character)
        language_pack = {
            "japanese": "japanese",
            "chinese simplified": "cjk-simplified",
            "chinese traditional": "cjk-traditional",
        }.get((language or "").strip().lower())
        if language_pack and pack_id in {"cjk-simplified", "cjk-traditional", "japanese"}:
            return language_pack
        if pack_id not in {"cjk-simplified", "cjk-traditional", "japanese"}:
            return self._script_pack(character)
        start = index
        end = index + 1
        while start > 0 and self._script_pack(text[start - 1]) in {"cjk-simplified", "cjk-traditional", "japanese"}:
            start -= 1
        while end < len(text) and self._script_pack(text[end]) in {"cjk-simplified", "cjk-traditional", "japanese"}:
            end += 1
        if any(self._is_japanese_context(item) or item in "日本語" for item in text[start:end]):
            return "japanese"
        return self._script_pack(character)

    @staticmethod
    def _matches_file(path: str, file_data: dict) -> bool:
        if not os_path.isfile(path) or os_path.getsize(path) != file_data["expectedBytes"]:
            return False
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest() == file_data["sha256"]

    def _pack_directory(self, pack_id: str, pack: dict) -> Optional[str]:
        if pack["bundled"]:
            return os_path.join(self.bundled_root, pack_id)
        if not self.cache_root:
            return None
        directory = os_path.join(self.cache_root, "packs", pack_id, pack["packVersion"])
        marker = os_path.join(directory, "installed.v1.json")
        try:
            with open(marker, encoding="utf-8") as handle:
                installed = json.load(handle)
            if installed.get("packId") != pack_id or installed.get("packVersion") != pack["packVersion"]:
                return None
        except (OSError, json.JSONDecodeError):
            return None
        return directory

    def _verified_font_path(self, pack_id: str) -> Optional[str]:
        if pack_id in self._verified_paths:
            return self._verified_paths[pack_id]
        pack = self.manifest["packs"].get(pack_id)
        directory = self._pack_directory(pack_id, pack) if pack else None
        if not directory:
            return None
        for file_data in pack["files"]:
            if not self._matches_file(os_path.join(directory, file_data["relativePath"]), file_data):
                return None
        font_data = next((item for item in pack["files"] if item["format"] == "ttf"), None)
        path = os_path.join(directory, font_data["relativePath"]) if font_data else None
        self._verified_paths[pack_id] = path
        return path

    def resolve_runs(self, text: str, language: Optional[str] = None) -> list[FontRun]:
        if not text:
            return []
        runs: list[FontRun] = []
        for index, character in enumerate(text):
            pack_id = self._pack_for_character(text, index, language)
            if character.isspace() and runs:
                pack_id = runs[-1].pack_id or "latin-greek-cyrillic"
                path = runs[-1].font_path
            else:
                path = self._verified_font_path(pack_id)
            current = FontRun(character, pack_id if path else None, path, path is None)
            if runs and runs[-1].pack_id == current.pack_id and runs[-1].uses_system_fallback == current.uses_system_fallback:
                runs[-1] = FontRun(runs[-1].text + character, current.pack_id, current.font_path, current.uses_system_fallback)
            else:
                runs.append(current)
        return runs
