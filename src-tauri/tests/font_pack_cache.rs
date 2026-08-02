use std::fs;

use tempfile::tempdir;
use vrct_lib::font_packs::{FontCache, FontManifest};

const MANIFEST: &str = r#"{
  "schemaVersion": 1,
  "manifestVersion": "1.0.0",
  "fontFamilyVersion": "noto-test",
  "sourceRevision": "2796410152d4f9524b68ed46e69c1b60f8e0f7c3",
  "packs": {
    "ethiopic": {
      "bundled": false,
      "displayName": "Noto Sans Ethiopic",
      "scripts": ["Ethi"],
      "family": "VRCNT Noto Core",
      "sourceFamily": "Noto Sans Ethiopic",
      "packVersion": "1.0.0",
      "licenseSpdx": "OFL-1.1",
      "copyrightNotice": "Copyright test",
      "files": [
        {"role":"web-and-pillow","relativePath":"font.ttf","format":"ttf","weightRange":[100,900],"sourceRevision":"2796410152d4f9524b68ed46e69c1b60f8e0f7c3","sourceUrl":"https://github.com/awakenginexe/VRCNT/releases/download/font-packs-v1/ethiopic-1.0.0.ttf","expectedBytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","licenseSpdx":"OFL-1.1"},
        {"role":"license","relativePath":"OFL.txt","format":"text","sourceRevision":"2796410152d4f9524b68ed46e69c1b60f8e0f7c3","sourceUrl":"https://github.com/awakenginexe/VRCNT/releases/download/font-packs-v1/ethiopic-1.0.0-OFL.txt","expectedBytes":3,"sha256":"4d7d32b8959dd38740f4fd2ae8c364a9df18ca156eaabc8b00b2ae23c24191cc","licenseSpdx":"OFL-1.1"}
      ]
    }
  }
}"#;

#[test]
fn rejects_unsupported_manifest_and_untrusted_file_urls() {
    assert!(FontManifest::parse("{\"schemaVersion\":2,\"packs\":{}}").is_err());
    assert!(FontManifest::parse(MANIFEST.replace("https://github.com", "http://example.test").as_str()).is_err());
    assert!(FontManifest::parse(MANIFEST.replace("font.ttf", "font.exe").as_str()).is_err());
}

#[test]
fn parses_the_shipped_bundled_manifest() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-python/models/overlay/fonts/font-packs.v1.json");
    let manifest = FontManifest::load(&path).unwrap();
    assert_eq!(manifest.schema_version, 1);
    assert!(manifest.pack("thai").unwrap().bundled);
}

#[test]
fn installs_a_verified_pack_atomically_and_recovers_incomplete_staging() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let source = temporary.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("font.ttf"), b"abc").unwrap();
    fs::write(source.join("OFL.txt"), b"ofl").unwrap();

    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();
    fs::create_dir_all(cache.staging_root().join("abandoned")).unwrap();
    cache.recover().unwrap();
    cache.install_from_directory("ethiopic", &source).unwrap();

    let installed = cache.installed_pack("ethiopic").unwrap().unwrap();
    assert_eq!(installed.pack_version, "1.0.0");
    assert_eq!(cache.total_verified_bytes().unwrap(), 6);
    assert!(!cache.staging_root().join("abandoned").exists());
}

#[test]
fn rejects_hash_mismatch_without_replacing_a_verified_pack() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let source = temporary.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("font.ttf"), b"nope").unwrap();
    fs::write(source.join("OFL.txt"), b"ofl").unwrap();
    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();

    assert!(cache.install_from_directory("ethiopic", &source).is_err());
    assert!(cache.installed_pack("ethiopic").unwrap().is_none());
}

#[test]
fn removes_only_optional_cache_packs() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();
    fs::create_dir_all(temporary.path().join("cache/packs/ethiopic/1.0.0")).unwrap();
    cache.remove_optional_pack("ethiopic").unwrap();
    assert!(!temporary.path().join("cache/packs/ethiopic").exists());
}
