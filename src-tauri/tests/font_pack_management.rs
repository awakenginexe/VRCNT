use std::path::Path;

use vrct_lib::font_packs::{FontCache, FontManifest};

#[test]
fn optional_pack_catalog_reports_verified_size_and_system_fallback_when_offline() {
    let manifest_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-python/models/overlay/fonts/font-packs.v1.json");
    let cache = FontCache::open_at(
        tempfile::tempdir().unwrap().path().join("cache"),
        FontManifest::load(&manifest_path).unwrap(),
    )
    .unwrap();

    let catalog = cache.optional_pack_catalog().unwrap();
    let ethiopic = catalog
        .packs
        .iter()
        .find(|pack| pack.id == "ethiopic")
        .unwrap();
    assert!(!ethiopic.installed);
    assert_eq!(ethiopic.activation_status, "system-fallback");
    assert!(ethiopic.size_bytes > 0);
    assert_eq!(catalog.total_bytes, 0);
}
