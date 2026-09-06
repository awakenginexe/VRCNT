import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


sys.path.insert(
    0,
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
)

if "requests" not in sys.modules:
    class _RequestException(Exception):
        pass

    requests_stub = types.ModuleType("requests")
    requests_stub.post = lambda *args, **kwargs: None
    requests_stub.get = lambda *args, **kwargs: None
    requests_stub.RequestException = _RequestException
    requests_stub.exceptions = types.SimpleNamespace(
        Timeout=_RequestException,
        HTTPError=_RequestException,
        ConnectionError=_RequestException,
    )
    sys.modules["requests"] = requests_stub

from config import (
    _copytree_merge,
    _migrateRenamedUserData,
    _resolveRenamedUserDataPath,
)


class VrcntDataMigrationTests(unittest.TestCase):
    def test_installer_moves_legacy_data_before_creating_vrcnt_data(self):
        repository_root = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..")
        )
        template_path = os.path.join(
            repository_root,
            "src-tauri",
            "nsis",
            "template.nsi",
        )
        with open(template_path, encoding="utf-8") as template_file:
            installer_source = template_file.read()

        legacy_assignment = (
            "$$legacyData = Join-Path $$env:LOCALAPPDATA "
            "'VRCNT-NextData'"
        )
        migration = (
            "Move-Item -LiteralPath $$legacyData "
            "-Destination $$data"
        )
        create_target = (
            "New-Item -ItemType Directory -Force -Path $$data"
        )
        self.assertIn(legacy_assignment, installer_source)
        self.assertIn(migration, installer_source)
        self.assertLess(
            installer_source.index(migration),
            installer_source.index(create_target),
        )

    def test_legacy_directory_copies_to_absent_vrcnt_data_directory_without_deleting_source(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(
                temporary_directory,
                "VRCNT-NextData",
            )
            target_path = os.path.join(temporary_directory, "VRCNTData")
            os.makedirs(os.path.join(legacy_path, "weights"))
            with open(
                os.path.join(legacy_path, "config.json"),
                "wb",
            ) as config_file:
                config_file.write(b'{"language":"th"}')
            with open(
                os.path.join(legacy_path, "weights", "model.bin"),
                "wb",
            ) as model_file:
                model_file.write(b"model-bytes")

            migrated = _migrateRenamedUserData(
                legacy_path,
                target_path,
            )

            self.assertTrue(migrated)
            self.assertTrue(os.path.exists(legacy_path))
            with open(
                os.path.join(target_path, "config.json"),
                "rb",
            ) as config_file:
                self.assertEqual(config_file.read(), b'{"language":"th"}')
            with open(
                os.path.join(target_path, "weights", "model.bin"),
                "rb",
            ) as model_file:
                self.assertEqual(model_file.read(), b"model-bytes")

    def test_existing_target_preserves_both_directories_and_never_overwrites_target(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(
                temporary_directory,
                "VRCNT-NextData",
            )
            target_path = os.path.join(temporary_directory, "VRCNTData")
            os.makedirs(legacy_path)
            os.makedirs(target_path)
            legacy_file = os.path.join(legacy_path, "config.json")
            target_file = os.path.join(target_path, "config.json")
            with open(legacy_file, "wb") as file_handle:
                file_handle.write(b"legacy")
            with open(target_file, "wb") as file_handle:
                file_handle.write(b"current")

            migrated = _migrateRenamedUserData(
                legacy_path,
                target_path,
            )

            self.assertTrue(migrated)
            with open(legacy_file, "rb") as file_handle:
                self.assertEqual(file_handle.read(), b"legacy")
            with open(target_file, "rb") as file_handle:
                self.assertEqual(file_handle.read(), b"current")

    def test_missing_legacy_directory_is_a_no_op(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(
                temporary_directory,
                "VRCNT-NextData",
            )
            target_path = os.path.join(temporary_directory, "VRCNTData")

            migrated = _migrateRenamedUserData(
                legacy_path,
                target_path,
            )

            self.assertFalse(migrated)
            self.assertFalse(os.path.exists(target_path))

    def test_failed_copy_uses_legacy_directory_without_deleting_source(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(
                temporary_directory,
                "VRCNT-NextData",
            )
            target_path = os.path.join(temporary_directory, "VRCNTData")
            os.makedirs(legacy_path)
            with open(os.path.join(legacy_path, "config.json"), "wb") as file_handle:
                file_handle.write(b"legacy")
            with patch(
                "config.shutil.copy2",
                side_effect=PermissionError("directory is in use"),
            ):
                selected_path = _resolveRenamedUserDataPath(
                    legacy_path,
                    target_path,
                )

            self.assertEqual(selected_path, legacy_path)
            self.assertTrue(os.path.isdir(legacy_path))

    def test_legacy_local_data_merge_never_overwrites_existing_user_files(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(temporary_directory, "legacy")
            target_path = os.path.join(temporary_directory, "VRCNTData")
            os.makedirs(os.path.join(legacy_path, "weights"))
            os.makedirs(os.path.join(target_path, "weights"))
            with open(os.path.join(legacy_path, "config.json"), "wb") as file_handle:
                file_handle.write(b"legacy-config")
            with open(os.path.join(target_path, "config.json"), "wb") as file_handle:
                file_handle.write(b"current-config")
            with open(os.path.join(legacy_path, "weights", "model.bin"), "wb") as file_handle:
                file_handle.write(b"legacy-model")
            with open(os.path.join(target_path, "weights", "model.bin"), "wb") as file_handle:
                file_handle.write(b"current-model")

            _copytree_merge(legacy_path, target_path)

            with open(os.path.join(target_path, "config.json"), "rb") as file_handle:
                self.assertEqual(file_handle.read(), b"current-config")
            with open(os.path.join(target_path, "weights", "model.bin"), "rb") as file_handle:
                self.assertEqual(file_handle.read(), b"current-model")

    def test_migration_preserves_configuration_presets_and_downloaded_model_data(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            legacy_path = os.path.join(temporary_directory, "VRCNT-NextData")
            target_path = os.path.join(temporary_directory, "VRCNTData")
            os.makedirs(os.path.join(legacy_path, "presets", "default"))
            os.makedirs(os.path.join(legacy_path, "weights"))
            with open(os.path.join(legacy_path, "config.json"), "wb") as file_handle:
                file_handle.write(b'{"UI_LANGUAGE":"th","API_PROVIDER":"local"}')
            with open(os.path.join(legacy_path, "presets", "default", "profile.json"), "wb") as file_handle:
                file_handle.write(b'{"name":"default"}')
            with open(os.path.join(legacy_path, "weights", "model.bin"), "wb") as file_handle:
                file_handle.write(b"downloaded-model")

            self.assertTrue(_migrateRenamedUserData(legacy_path, target_path))
            self.assertTrue(os.path.isdir(legacy_path))
            for relative_path, expected in (
                ("config.json", b'{"UI_LANGUAGE":"th","API_PROVIDER":"local"}'),
                ("presets/default/profile.json", b'{"name":"default"}'),
                ("weights/model.bin", b"downloaded-model"),
            ):
                with open(os.path.join(target_path, relative_path), "rb") as file_handle:
                    self.assertEqual(file_handle.read(), expected)


if __name__ == "__main__":
    unittest.main()
