use std::path::Path;

use vrct_lib::font_packs::{FontCache, FontManifest};

#[test]
fn resolves_only_requested_verified_bundled_font_assets() {
    let manifest_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-python/models/overlay/fonts/font-packs.v1.json");
    let bundled_root = manifest_path.parent().unwrap();
    let cache = FontCache::open_at(
        tempfile::tempdir().unwrap().path().join("cache"),
        FontManifest::load(&manifest_path).unwrap(),
    )
    .unwrap();

    let assets = cache
        .managed_font_assets(bundled_root, &["thai".into()])
        .unwrap();
    assert_eq!(assets.len(), 1);
    assert_eq!(assets[0].pack_id, "thai");
    assert_eq!(assets[0].family, "VRCNT Noto");
    assert!(assets[0].path.ends_with(
        std::path::Path::new("thai")
            .join("font.ttf")
            .to_string_lossy()
            .as_ref()
    ));
}

#[test]
fn unavailable_optional_assets_are_omitted_so_webviews_keep_system_fallback() {
    let manifest_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-python/models/overlay/fonts/font-packs.v1.json");
    let bundled_root = manifest_path.parent().unwrap();
    let cache = FontCache::open_at(
        tempfile::tempdir().unwrap().path().join("cache"),
        FontManifest::load(&manifest_path).unwrap(),
    )
    .unwrap();

    assert!(cache
        .managed_font_assets(bundled_root, &["ethiopic".into()])
        .unwrap()
        .is_empty());
}
