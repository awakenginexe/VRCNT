import os
import sys
import tempfile
import unittest


sys.path.insert(
    0,
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
)

from config import _migrateRenamedUserData


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

    def test_legacy_directory_moves_to_absent_vrcnt_data_directory(self):
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
            self.assertFalse(os.path.exists(legacy_path))
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

    def test_existing_target_leaves_both_directories_unchanged(self):
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

            self.assertFalse(migrated)
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


if __name__ == "__main__":
    unittest.main()
