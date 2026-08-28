use font_kit::source::SystemSource;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

pub mod font_packs;
pub mod runtime_activation;

const BACKGROUND_STARTUP_ARGUMENT: &str = "--vrcnt-background";
const VRCHAT_PROCESS_NAME: &str = "VRChat.exe";
const VRCHAT_PROCESS_POLL_INTERVAL: Duration = Duration::from_secs(2);
const BACKGROUND_TRAY_ID: &str = "vrcnt-background-startup";
const RESIDENT_ACTIVATE_EVENT: &str = "vrcnt://resident-activate";
const RESIDENT_CLOSE_REQUESTED_EVENT: &str = "vrcnt://resident-close-requested";

struct ResidentRuntimeState {
    waiting_for_activation: AtomicBool,
    activation_pending: AtomicBool,
    watcher_active: AtomicBool,
}

impl ResidentRuntimeState {
    fn new() -> Self {
        Self {
            waiting_for_activation: AtomicBool::new(false),
            activation_pending: AtomicBool::new(false),
            watcher_active: AtomicBool::new(false),
        }
    }
}

pub fn is_background_launch(args: &[String]) -> bool {
    args.iter()
        .any(|argument| argument == BACKGROUND_STARTUP_ARGUMENT)
}

pub fn is_vrchat_process_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(VRCHAT_PROCESS_NAME)
}

pub fn should_activate_vrchat(previously_running: bool, currently_running: bool) -> bool {
    currently_running && !previously_running
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };

    let _ = main_window.show();
    let _ = main_window.unminimize();
    let _ = main_window.set_focus();
}

fn activate_main_window(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<ResidentRuntimeState>() {
        state.waiting_for_activation.store(false, Ordering::SeqCst);
        state.activation_pending.store(true, Ordering::SeqCst);
    }
    show_main_window(app);
    let _ = app.emit(RESIDENT_ACTIVATE_EVENT, ());
}

fn wait_for_vrchat_start_and_activate(app: tauri::AppHandle) {
    let Some(state) = app.try_state::<ResidentRuntimeState>() else {
        return;
    };
    if state
        .watcher_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    thread::spawn(move || {
        let mut system = System::new();
        let mut previously_running = false;
        let mut has_process_sample = false;

        loop {
            system.refresh_processes(ProcessesToUpdate::All, true);
            let vrchat_is_running = system.processes().values().any(|process| {
                process
                    .name()
                    .to_str()
                    .map(is_vrchat_process_name)
                    .unwrap_or(false)
            });

            if has_process_sample && should_activate_vrchat(previously_running, vrchat_is_running) {
                activate_main_window(&app);
                break;
            }

            has_process_sample = true;
            previously_running = vrchat_is_running;
            thread::sleep(VRCHAT_PROCESS_POLL_INTERVAL);
        }

        if let Some(state) = app.try_state::<ResidentRuntimeState>() {
            state.watcher_active.store(false, Ordering::SeqCst);
        }
    });
}

fn ensure_background_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.tray_by_id(BACKGROUND_TRAY_ID).is_some() {
        return Ok(());
    }

    let open_vrcnt = MenuItem::with_id(app, "open-vrcnt", "Open VRCNT", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit-vrcnt", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_vrcnt, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("VRCNT tray icon is unavailable")?;

    TrayIconBuilder::with_id(BACKGROUND_TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("VRCNT")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-vrcnt" => activate_main_window(app),
            "quit-vrcnt" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn set_up_background_mode(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("VRCNT main window is unavailable")?;
    main_window.hide()?;

    if let Some(state) = app.try_state::<ResidentRuntimeState>() {
        state.waiting_for_activation.store(true, Ordering::SeqCst);
        state.activation_pending.store(false, Ordering::SeqCst);
    }
    ensure_background_tray(app)?;
    wait_for_vrchat_start_and_activate(app.clone());
    Ok(())
}

fn configure_close_behavior(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("VRCNT main window is unavailable")?;
    let app_handle = app.handle().clone();

    main_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let start_with_vrchat = app_handle.autolaunch().is_enabled().unwrap_or(false);
            if start_with_vrchat {
                api.prevent_close();
                let _ = app_handle.emit(RESIDENT_CLOSE_REQUESTED_EVENT, ());
            }
        }
    });

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

    let launch_args = std::env::args().collect::<Vec<_>>();
    let background_launch = is_background_launch(&launch_args);
    let runtime_activation =
        runtime_activation::RuntimeActivationContext::from_launch_args(&launch_args)
            .expect("Invalid runtime activation arguments")
            .unwrap_or_else(runtime_activation::RuntimeActivationContext::inactive);

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
        .manage(ResidentRuntimeState::new())
        .manage(runtime_activation)
        .setup(move |app| -> Result<(), Box<dyn std::error::Error>> {
            configure_close_behavior(app)?;
            if background_launch {
                set_up_background_mode(&app.handle())?;
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
            enter_background_mode,
            is_background_startup,
            consume_resident_activation,
            get_runtime_activation_context,
            signal_runtime_activation_ready,
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
fn enter_background_mode(app: tauri::AppHandle) -> Result<(), String> {
    set_up_background_mode(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn is_background_startup(state: tauri::State<'_, ResidentRuntimeState>) -> bool {
    state.waiting_for_activation.load(Ordering::SeqCst)
}

#[tauri::command]
fn consume_resident_activation(state: tauri::State<'_, ResidentRuntimeState>) -> bool {
    state.activation_pending.swap(false, Ordering::SeqCst)
}

#[tauri::command]
fn get_runtime_activation_context(
    state: tauri::State<'_, runtime_activation::RuntimeActivationContext>,
) -> Option<runtime_activation::RuntimeActivationFrontendContext> {
    state.frontend_context()
}

#[tauri::command]
fn signal_runtime_activation_ready(
    backend_ready: bool,
    state: tauri::State<'_, runtime_activation::RuntimeActivationContext>,
) -> Result<bool, String> {
    state
        .signal_ready(backend_ready)
        .map_err(|error| error.to_string())
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
        migrate_directory_with, should_activate_vrchat,
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

    #[test]
    fn vrchat_activation_requires_a_new_process_transition() {
        assert!(should_activate_vrchat(false, true));
        assert!(!should_activate_vrchat(true, true));
        assert!(!should_activate_vrchat(false, false));
    }
}
