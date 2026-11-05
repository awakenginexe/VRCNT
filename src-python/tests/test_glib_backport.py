import unittest
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class GlibBackportRoutingTests(unittest.TestCase):
    def test_linux_dependency_graph_uses_local_backport_instead_of_registry_glib(self):
        manifest = tomllib.loads((ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))
        patch = manifest.get("patch", {}).get("crates-io", {}).get("glib", {})
        self.assertIn("path", patch, "GTK must resolve GLib through the security backport")
        vendor = (ROOT / "src-tauri" / patch["path"]).resolve()
        self.assertTrue(vendor.is_relative_to(ROOT / "src-tauri/vendor"))
        package = tomllib.loads((vendor / "Cargo.toml").read_text(encoding="utf-8"))["package"]
        self.assertEqual(package["name"], "glib")
        self.assertEqual(package["version"], "0.18.5")
        lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
        matches = [p for p in lock["package"] if p["name"] == "glib"]
        self.assertEqual(len(matches), 1)
        self.assertNotIn("source", matches[0], "registry GLib must not remain in the resolved graph")


if __name__ == "__main__":
    unittest.main()
