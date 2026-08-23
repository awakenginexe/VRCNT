use font_kit::source::SystemSource;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

pub mod font_packs;

const BACKGROUND_STARTUP_ARGUMENT: &str = "--vrcnt-background";
const VRCHAT_PROCESS_NAME: &str = "VRChat.exe";
const VRCHAT_PROCESS_POLL_INTERVAL: Duration = Duration::from_secs(2);

pub fn is_background_launch(args: &[String]) -> bool {
    args.iter()
        .any(|argument| argument == BACKGROUND_STARTUP_ARGUMENT)
}

pub fn is_vrchat_process_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(VRCHAT_PROCESS_NAME)
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };

    let _ = main_window.show();
    let _ = main_window.unminimize();
    let _ = main_window.set_focus();
}

fn wait_for_vrchat_and_show_main_window(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut system = System::new();

        loop {
            system.refresh_processes(ProcessesToUpdate::All, true);
            let vrchat_is_running = system.processes().values().any(|process| {
                process
                    .name()
                    .to_str()
                    .map(is_vrchat_process_name)
                    .unwrap_or(false)
            });

            if vrchat_is_running {
                show_main_window(&app);
                return;
            }

            thread::sleep(VRCHAT_PROCESS_POLL_INTERVAL);
        }
    });
}

fn set_up_background_startup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("VRCNT main window is unavailable")?;
    main_window.hide()?;

    let open_vrcnt = MenuItem::with_id(app, "open-vrcnt", "Open VRCNT", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit-vrcnt", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_vrcnt, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("VRCNT tray icon is unavailable")?;

    let _tray_icon = TrayIconBuilder::with_id("vrcnt-background-startup")
        .icon(icon)
        .menu(&menu)
        .tooltip("VRCNT")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-vrcnt" => show_main_window(app),
            "quit-vrcnt" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    wait_for_vrchat_and_show_main_window(app.handle().clone());
    Ok(())
}

fn managed_font_resource_root(
    app: &tauri::App,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let packaged = app.path().resource_dir()?.join("_internal/fonts");
    if packaged.join("font-packs.v1.json").is_file() {
        return Ok(packaged);
    }

    let development =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-python/models/overlay/fonts");
    if development.join("font-packs.v1.json").is_file() {
        return Ok(development);
    }

    Err("Managed font resources are unavailable".into())
}

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

    let background_launch = is_background_launch(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![BACKGROUND_STARTUP_ARGUMENT]),
        ))
        .setup(move |app| -> Result<(), Box<dyn std::error::Error>> {
            if background_launch {
                set_up_background_startup(app)?;
            }

            let font_root = managed_font_resource_root(app)?;
            let manifest = font_root.join("font-packs.v1.json");
            let service = font_packs::FontPackDownloadService::open_with_bundled_root(
                font_packs::FontCache::default_root(),
                &manifest,
                &font_root,
            )
            .map_err(io::Error::other)?;
            app.manage(service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_font_list,
            font_packs::download_optional_font_pack,
            font_packs::cancel_optional_font_pack,
            font_packs::resolve_managed_font_assets,
            font_packs::optional_font_pack_catalog,
            font_packs::remove_optional_font_pack,
        ])
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

#[cfg(test)]
mod tests {
    use super::{
        is_background_launch, is_vrchat_process_name, migrate_directory_if_target_absent,
        migrate_directory_with,
    };
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

    #[test]
    fn background_launch_requires_the_exact_startup_argument() {
        assert!(is_background_launch(&[
            "VRCNT.exe".to_owned(),
            "--vrcnt-background".to_owned(),
        ]));
        assert!(!is_background_launch(&[
            "VRCNT.exe".to_owned(),
            "--vrcnt-background-mode".to_owned(),
        ]));
        assert!(!is_background_launch(&[
            "VRCNT.exe".to_owned(),
            "--VRCNT-BACKGROUND".to_owned(),
        ]));
    }

    #[test]
    fn vrchat_process_matching_is_exact_and_case_insensitive() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(is_vrchat_process_name("vrchat.EXE"));
        assert!(!is_vrchat_process_name("VRChat.exe.bak"));
        assert!(!is_vrchat_process_name("not-vrchat.exe"));
        assert!(!is_vrchat_process_name("VRChat"));
    }
}
