use std::fs;

use tempfile::tempdir;
use vrct_lib::font_packs::{FontCache, FontManifest};

const FONT: &[u8] = include_bytes!("../../src-python/models/overlay/fonts/thai/font.ttf");
const LICENSE: &[u8] = include_bytes!("../../src-python/models/overlay/fonts/thai/OFL.txt");

const MANIFEST: &str = r#"{
  "schemaVersion": 1,
  "manifestVersion": "1.0.0",
  "fontFamilyVersion": "noto-test",
  "sourceRevision": "2796410152d4f9524b68ed46e69c1b60f8e0f7c3",
  "packs": {
    "thai": {
      "bundled": false,
      "displayName": "Noto Sans Thai",
      "scripts": ["Thai"],
      "family": "VRCNT Noto Core",
      "sourceFamily": "Noto Sans Thai",
      "packVersion": "1.0.0",
      "licenseSpdx": "OFL-1.1",
      "copyrightNotice": "Copyright test",
      "files": [
        {"role":"web-and-pillow","relativePath":"font.ttf","format":"ttf","weightRange":[100,900],"sourceRevision":"2796410152d4f9524b68ed46e69c1b60f8e0f7c3","sourceUrl":"https://raw.githubusercontent.com/google/fonts/2796410152d4f9524b68ed46e69c1b60f8e0f7c3/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf","expectedBytes":218652,"sha256":"5a1c559bb539583c8a1fd99d1c5b9491e5e14478c9cd2bd0970d5c3096cc9ef8","licenseSpdx":"OFL-1.1"},
        {"role":"license","relativePath":"OFL.txt","format":"text","sourceRevision":"2796410152d4f9524b68ed46e69c1b60f8e0f7c3","sourceUrl":"https://raw.githubusercontent.com/google/fonts/2796410152d4f9524b68ed46e69c1b60f8e0f7c3/ofl/notosansthai/OFL.txt","expectedBytes":4380,"sha256":"2e98fd23a52d253db8612cd5942c8f2ff4111b21d2367050fdca91d8ccc374a0","licenseSpdx":"OFL-1.1"}
      ]
    }
  }
}"#;

#[test]
fn rejects_unsupported_manifest_and_untrusted_file_urls() {
    assert!(FontManifest::parse("{\"schemaVersion\":2,\"packs\":{}}").is_err());
    assert!(FontManifest::parse(
        MANIFEST
            .replace("https://raw.githubusercontent.com", "http://example.test")
            .as_str()
    )
    .is_err());
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
fn shipped_optional_entries_use_only_pinned_official_google_fonts_raw_assets() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-python/models/overlay/fonts/font-packs.v1.json");
    let manifest = FontManifest::load(&path).unwrap();
    let optional_packs: Vec<_> = manifest
        .packs
        .values()
        .filter(|pack| !pack.bundled)
        .collect();

    assert_eq!(optional_packs.len(), 14);
    for pack in optional_packs {
        for file in &pack.files {
            assert!(file.source_url.starts_with(
                "https://raw.githubusercontent.com/google/fonts/2796410152d4f9524b68ed46e69c1b60f8e0f7c3/ofl/"
            ));
        }
    }
}

#[test]
fn installs_a_verified_pack_atomically_and_recovers_incomplete_staging() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let source = temporary.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("font.ttf"), FONT).unwrap();
    fs::write(source.join("OFL.txt"), LICENSE).unwrap();

    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();
    fs::create_dir_all(cache.staging_root().join("abandoned")).unwrap();
    cache.recover().unwrap();
    cache.install_from_directory("thai", &source).unwrap();

    let installed = cache.installed_pack("thai").unwrap().unwrap();
    assert_eq!(installed.pack_version, "1.0.0");
    assert_eq!(cache.total_verified_bytes().unwrap(), 223032);
    assert!(!cache.staging_root().join("abandoned").exists());
}

#[test]
fn rejects_hash_mismatch_without_replacing_a_verified_pack() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let source = temporary.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("font.ttf"), b"nope").unwrap();
    fs::write(source.join("OFL.txt"), LICENSE).unwrap();
    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();

    assert!(cache.install_from_directory("thai", &source).is_err());
    assert!(cache.installed_pack("thai").unwrap().is_none());
}

#[test]
fn removes_only_optional_cache_packs() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();
    fs::create_dir_all(temporary.path().join("cache/packs/thai/1.0.0")).unwrap();
    cache.remove_optional_pack("thai").unwrap();
    assert!(!temporary.path().join("cache/packs/thai").exists());
}

#[test]
fn corrupt_installed_marker_is_cleaned_without_touching_staging() {
    let manifest = FontManifest::parse(MANIFEST).unwrap();
    let temporary = tempdir().unwrap();
    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();
    let corrupt = temporary.path().join("cache/packs/thai/1.0.0");
    fs::create_dir_all(&corrupt).unwrap();
    fs::write(corrupt.join("installed.v1.json"), b"not JSON").unwrap();

    assert!(cache.installed_pack("thai").unwrap().is_none());
    assert!(!corrupt.exists());
    assert!(fs::read_dir(cache.staging_root()).unwrap().next().is_none());
}
