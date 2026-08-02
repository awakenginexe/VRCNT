use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tempfile::tempdir;
use vrct_lib::font_packs::{
    FontCache, FontDownloadCancellation, FontManifest, FontPackDownloadManager,
    FontPackDownloadService,
};

const FONT: &[u8] = include_bytes!("../../src-python/models/overlay/fonts/thai/font.ttf");
const LICENSE: &[u8] = include_bytes!("../../src-python/models/overlay/fonts/thai/OFL.txt");

fn manifest(pack_version: &str, source_family: &str) -> FontManifest {
    FontManifest::parse(&format!(
        r#"{{
          "schemaVersion": 1,
          "manifestVersion": "1.0.0",
          "fontFamilyVersion": "noto-test",
          "sourceRevision": "2796410152d4f9524b68ed46e69c1b60f8e0f7c3",
          "packs": {{
            "thai": {{
              "bundled": false,
              "displayName": "Noto Sans Thai",
              "scripts": ["Thai"],
              "family": "VRCNT Noto Core",
              "sourceFamily": "{source_family}",
              "packVersion": "{pack_version}",
              "licenseSpdx": "OFL-1.1",
              "copyrightNotice": "Copyright test",
              "files": [
                {{"role":"web-and-pillow","relativePath":"font.ttf","format":"ttf","weightRange":[100,900],"sourceRevision":"2796410152d4f9524b68ed46e69c1b60f8e0f7c3","sourceUrl":"https://raw.githubusercontent.com/google/fonts/2796410152d4f9524b68ed46e69c1b60f8e0f7c3/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf","expectedBytes":218652,"sha256":"5a1c559bb539583c8a1fd99d1c5b9491e5e14478c9cd2bd0970d5c3096cc9ef8","licenseSpdx":"OFL-1.1"}},
                {{"role":"license","relativePath":"OFL.txt","format":"text","sourceRevision":"2796410152d4f9524b68ed46e69c1b60f8e0f7c3","sourceUrl":"https://raw.githubusercontent.com/google/fonts/2796410152d4f9524b68ed46e69c1b60f8e0f7c3/ofl/notosansthai/OFL.txt","expectedBytes":4380,"sha256":"2e98fd23a52d253db8612cd5942c8f2ff4111b21d2367050fdca91d8ccc374a0","licenseSpdx":"OFL-1.1"}}
              ]
            }}
          }}
        }}"#
    ))
    .unwrap()
}

fn fixture_download(
    file: &vrct_lib::font_packs::FontPackFile,
    destination: &std::path::Path,
    cancellation: &FontDownloadCancellation,
    report: &mut dyn FnMut(u64),
) -> Result<(), String> {
    if cancellation.is_cancelled() {
        return Err("Font pack download cancelled".into());
    }
    let contents = if file.relative_path == "font.ttf" {
        FONT
    } else {
        LICENSE
    };
    fs::write(destination, contents).map_err(|error| error.to_string())?;
    report(contents.len() as u64);
    Ok(())
}

#[test]
fn installs_verified_local_fixture_after_retry_without_network_access() {
    let temporary = tempdir().unwrap();
    let cache = FontCache::open_at(
        temporary.path().join("cache"),
        manifest("1.0.0", "Noto Sans Thai"),
    )
    .unwrap();
    let attempts = AtomicUsize::new(0);
    let mut progress = Vec::new();

    cache
        .download_optional_with(
            "thai",
            3,
            &FontDownloadCancellation::new(),
            |file, destination, cancellation, report| {
                if attempts.fetch_add(1, Ordering::SeqCst) < 2 {
                    return Err("controlled temporary failure".into());
                }
                fixture_download(file, destination, cancellation, report)
            },
            |event| progress.push(event),
        )
        .unwrap();

    assert!(cache.installed_pack("thai").unwrap().is_some());
    assert!(progress.iter().any(|event| event.state == "retrying"));
    assert!(progress.iter().any(|event| event.state == "complete"));
}

#[test]
fn rejects_font_with_wrong_internal_family_and_cleans_staging() {
    let temporary = tempdir().unwrap();
    let cache = FontCache::open_at(
        temporary.path().join("cache"),
        manifest("1.0.0", "Incorrect family"),
    )
    .unwrap();

    let error = cache
        .download_optional_with(
            "thai",
            1,
            &FontDownloadCancellation::new(),
            fixture_download,
            |_| {},
        )
        .unwrap_err();

    assert!(error.contains("family metadata"));
    assert!(cache.installed_pack("thai").unwrap().is_none());
    assert!(fs::read_dir(cache.staging_root()).unwrap().next().is_none());
}

#[test]
fn rejects_font_without_the_manifest_representative_script_glyph() {
    let temporary = tempdir().unwrap();
    let mut manifest = manifest("1.0.0", "Noto Sans Thai");
    manifest.packs.get_mut("thai").unwrap().scripts = vec!["Ethi".into()];
    let cache = FontCache::open_at(temporary.path().join("cache"), manifest).unwrap();

    let error = cache
        .download_optional_with(
            "thai",
            1,
            &FontDownloadCancellation::new(),
            fixture_download,
            |_| {},
        )
        .unwrap_err();

    assert!(error.contains("representative Ethi glyph"));
    assert!(cache.installed_pack("thai").unwrap().is_none());
}

#[test]
fn failed_replacement_keeps_an_existing_verified_version() {
    let temporary = tempdir().unwrap();
    let source = temporary.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("font.ttf"), FONT).unwrap();
    fs::write(source.join("OFL.txt"), LICENSE).unwrap();

    let cache_v1 = FontCache::open_at(
        temporary.path().join("cache"),
        manifest("1.0.0", "Noto Sans Thai"),
    )
    .unwrap();
    cache_v1.install_from_directory("thai", &source).unwrap();

    let cache_v2 = FontCache::open_at(
        temporary.path().join("cache"),
        manifest("2.0.0", "Noto Sans Thai"),
    )
    .unwrap();
    assert!(cache_v2
        .download_optional_with(
            "thai",
            1,
            &FontDownloadCancellation::new(),
            |_, _, _, _| Err("controlled failure".into()),
            |_| {}
        )
        .is_err());

    assert!(temporary
        .path()
        .join("cache/packs/thai/1.0.0/installed.v1.json")
        .is_file());
    assert!(cache_v2.installed_pack("thai").unwrap().is_none());
}

#[test]
fn cancellation_cleans_partial_downloads() {
    let temporary = tempdir().unwrap();
    let cache = Arc::new(
        FontCache::open_at(
            temporary.path().join("cache"),
            manifest("1.0.0", "Noto Sans Thai"),
        )
        .unwrap(),
    );
    let manager = FontPackDownloadManager::default();
    let download_cache = cache.clone();
    let download_manager = manager.clone();

    let worker = thread::spawn(move || {
        download_manager.download_optional_with(
            download_cache,
            "thai",
            1,
            |file, destination, cancellation, report| {
                if file.relative_path == "font.ttf" {
                    fs::write(destination, FONT).map_err(|error| error.to_string())?;
                    report(FONT.len() as u64);
                    while !cancellation.is_cancelled() {
                        thread::sleep(Duration::from_millis(5));
                    }
                }
                fixture_download(file, destination, cancellation, report)
            },
            |_| {},
        )
    });

    thread::sleep(Duration::from_millis(30));
    assert!(manager.cancel("thai"));
    assert!(worker.join().unwrap().is_err());
    assert!(fs::read_dir(cache.staging_root()).unwrap().next().is_none());
}

#[test]
fn concurrent_requests_share_one_local_download() {
    let temporary = tempdir().unwrap();
    let cache = Arc::new(
        FontCache::open_at(
            temporary.path().join("cache"),
            manifest("1.0.0", "Noto Sans Thai"),
        )
        .unwrap(),
    );
    let manager = FontPackDownloadManager::default();
    let file_count = Arc::new(AtomicUsize::new(0));

    let first_manager = manager.clone();
    let first_cache = cache.clone();
    let first_count = file_count.clone();
    let first = thread::spawn(move || {
        first_manager.download_optional_with(
            first_cache,
            "thai",
            1,
            |file, destination, cancellation, report| {
                first_count.fetch_add(1, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(50));
                fixture_download(file, destination, cancellation, report)
            },
            |_| {},
        )
    });

    thread::sleep(Duration::from_millis(10));
    let second_manager = manager.clone();
    let second_cache = cache.clone();
    let second_count = file_count.clone();
    let second = thread::spawn(move || {
        second_manager.download_optional_with(
            second_cache,
            "thai",
            1,
            |file, destination, cancellation, report| {
                second_count.fetch_add(1, Ordering::SeqCst);
                fixture_download(file, destination, cancellation, report)
            },
            |_| {},
        )
    });

    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();
    assert_eq!(file_count.load(Ordering::SeqCst), 2);
}

#[test]
fn a_second_manager_cannot_recover_an_active_cache() {
    let temporary = tempdir().unwrap();
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-python/models/overlay/fonts/font-packs.v1.json");
    let root = temporary.path().join("cache");
    let first = FontPackDownloadService::open(root.clone(), &manifest).unwrap();

    let error = match FontPackDownloadService::open(root.clone(), &manifest) {
        Ok(_) => panic!("a second manager unexpectedly opened the active cache"),
        Err(error) => error,
    };
    assert!(error.contains("already in use"));

    drop(first);
    FontPackDownloadService::open(root, &manifest).unwrap();
}
