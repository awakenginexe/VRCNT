use font_kit::source::SystemSource;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;

pub mod font_packs;

fn migrate_directory_if_target_absent(legacy_path: &Path, target_path: &Path) -> io::Result<bool> {
    migrate_directory_with(legacy_path, target_path, |legacy, target| {
        fs::rename(legacy, target)
    })
}

fn migrate_directory_with<F>(legacy_path: &Path, target_path: &Path, rename: F) -> io::Result<bool>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    if !legacy_path.is_dir() || target_path.exists() {
        return Ok(false);
    }
    rename(legacy_path, target_path)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn migrate_renamed_webview_data() -> io::Result<bool> {
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
        return Ok(false);
    };
    let local_app_data = Path::new(&local_app_data);
    migrate_directory_if_target_absent(
        &local_app_data.join("com.vrcnt-next.app"),
        &local_app_data.join("com.vrcnt.app"),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    migrate_renamed_webview_data().expect("Could not migrate the legacy VRCNT WebView data");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_font_list, download_zip_asset])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn get_font_list() -> Vec<String> {
    let source = SystemSource::new();
    let mut font_families = HashSet::new();

    if let Ok(fonts) = source.all_fonts() {
        for font in fonts {
            if let Ok(info) = font.load() {
                font_families.insert(info.family_name().to_string());
            }
        }
    }

    font_families.into_iter().collect()
}

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

#[tauri::command]
async fn download_zip_asset(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP error: {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Reading bytes error: {}", e))?;

    Ok(BASE64.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::{migrate_directory_if_target_absent, migrate_directory_with};
    use std::fs;
    use std::io;
    use tempfile::tempdir;

    #[test]
    fn legacy_webview_directory_moves_when_target_is_absent() {
        let temporary = tempdir().unwrap();
        let legacy = temporary.path().join("com.vrcnt-next.app");
        let target = temporary.path().join("com.vrcnt.app");
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join("Local Storage"), b"overlay settings").unwrap();

        assert!(migrate_directory_if_target_absent(&legacy, &target).unwrap());
        assert!(!legacy.exists());
        assert_eq!(
            fs::read(target.join("Local Storage")).unwrap(),
            b"overlay settings",
        );
    }

    #[test]
    fn existing_target_leaves_both_webview_directories_unchanged() {
        let temporary = tempdir().unwrap();
        let legacy = temporary.path().join("com.vrcnt-next.app");
        let target = temporary.path().join("com.vrcnt.app");
        fs::create_dir(&legacy).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(legacy.join("state"), b"legacy").unwrap();
        fs::write(target.join("state"), b"current").unwrap();

        assert!(!migrate_directory_if_target_absent(&legacy, &target).unwrap());
        assert_eq!(fs::read(legacy.join("state")).unwrap(), b"legacy");
        assert_eq!(fs::read(target.join("state")).unwrap(), b"current");
    }

    #[test]
    fn missing_legacy_webview_directory_is_a_no_op() {
        let temporary = tempdir().unwrap();
        let legacy = temporary.path().join("com.vrcnt-next.app");
        let target = temporary.path().join("com.vrcnt.app");

        assert!(!migrate_directory_if_target_absent(&legacy, &target).unwrap());
        assert!(!target.exists());
    }

    #[test]
    fn failed_webview_rename_leaves_target_absent_for_next_launch() {
        let temporary = tempdir().unwrap();
        let legacy = temporary.path().join("com.vrcnt-next.app");
        let target = temporary.path().join("com.vrcnt.app");
        fs::create_dir(&legacy).unwrap();

        let result = migrate_directory_with(&legacy, &target, |_legacy, _target| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "directory is in use",
            ))
        });

        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied,);
        assert!(legacy.exists());
        assert!(!target.exists());
    }
}
