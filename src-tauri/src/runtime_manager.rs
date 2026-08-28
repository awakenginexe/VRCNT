use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DATA_ROOT_NAME: &str = "VRCNTData";
const MANAGER_DIRECTORY_NAME: &str = "VRCNTInstaller";
const MANAGER_FILE_NAME: &str = "VRCNT.Setup.exe";
const RUNTIME_STATE_FILE_NAME: &str = "runtime.json";
const RUNTIME_MARKER_FILE_NAME: &str = "VRCNT.runtime.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStateDto {
    pub schema: u32,
    pub status: String,
    pub product: String,
    pub version: String,
    pub variant: String,
    pub architecture: String,
    pub install_path: String,
    pub updated_at_utc: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeVariant {
    Cpu,
    Cuda,
}

impl RuntimeVariant {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "cpu" => Ok(Self::Cpu),
            "cuda" => Ok(Self::Cuda),
            _ => Err("Runtime variant must be cpu or cuda.".to_owned()),
        }
    }

    fn from_state(value: &str) -> Option<Self> {
        match value {
            "Cpu" | "cpu" => Some(Self::Cpu),
            "Cuda" | "cuda" => Some(Self::Cuda),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Cpu => "cpu",
            Self::Cuda => "cuda",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStateRecord {
    schema: u32,
    status: String,
    product: String,
    version: String,
    variant: String,
    architecture: String,
    install_path: String,
    marker_build_identity: String,
    marker_sha256: String,
    updated_at_utc: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeMarker {
    product: String,
    version: String,
    variant: String,
    architecture: String,
    build_identity: String,
}

#[tauri::command]
pub fn get_runtime_state() -> Result<RuntimeStateDto, String> {
    let Some(data_root) = resolve_data_root() else {
        return Ok(recovery_state());
    };
    read_runtime_state_from_data_root(&data_root)
}

#[tauri::command]
pub fn launch_runtime_switch(variant: String) -> Result<(), String> {
    let target = RuntimeVariant::parse(&variant)?;
    let Some(data_root) = resolve_data_root() else {
        return Err("Runtime recovery is required before switching.".to_owned());
    };
    let state = read_runtime_state_from_data_root(&data_root)?;
    if state.status != "active" {
        return Err("Runtime recovery is required before switching.".to_owned());
    }
    if state.variant == target.as_str() {
        return Err("The selected runtime is already active.".to_owned());
    }

    let install_path = PathBuf::from(&state.install_path);
    validate_current_app_path(&install_path)?;
    let manager_path = resolve_and_validate_stable_manager()?;
    let manager_directory = manager_path
        .parent()
        .ok_or_else(|| "The stable setup manager path is invalid.".to_owned())?;

    let mut command = Command::new(&manager_path);
    command
        .current_dir(manager_directory)
        .arg("--switch")
        .arg("--variant")
        .arg(target.as_str())
        .arg("--install-path")
        .arg(&state.install_path);
    command
        .spawn()
        .map_err(|_| "VRCNT could not launch the trusted setup manager.".to_owned())?;

    Ok(())
}

pub fn read_runtime_state_from_data_root(data_root: &Path) -> Result<RuntimeStateDto, String> {
    let validated_root = match validate_data_root(data_root) {
        Ok(root) => root,
        Err(_) => return Ok(recovery_state()),
    };
    let state = match fs::read(validated_root.join(RUNTIME_STATE_FILE_NAME))
        .ok()
        .and_then(|contents| serde_json::from_slice::<RuntimeStateRecord>(&contents).ok())
    {
        Some(state) => state,
        None => return Ok(recovery_state()),
    };

    match validate_runtime_state(&validated_root, state) {
        Ok(state) => Ok(state),
        Err(_) => Ok(recovery_state()),
    }
}

pub fn resolve_stable_manager_path(local_app_data: &Path) -> Result<PathBuf, String> {
    if !local_app_data.is_absolute() {
        return Err("The local application data root is invalid.".to_owned());
    }
    Ok(local_app_data
        .join(MANAGER_DIRECTORY_NAME)
        .join(MANAGER_FILE_NAME))
}

fn resolve_data_root() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .or_else(|| env::var_os("APPDATA"))
        .or_else(|| env::var_os("USERPROFILE"))
        .map(|root| PathBuf::from(root).join(DATA_ROOT_NAME))
}

fn resolve_and_validate_stable_manager() -> Result<PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "The stable setup manager requires LOCALAPPDATA.".to_owned())?;
    let expected_manager = resolve_stable_manager_path(&local_app_data)?;
    let local_root = fs::canonicalize(&local_app_data)
        .map_err(|_| "The local application data root is unavailable.".to_owned())?;
    let manager = fs::canonicalize(&expected_manager).map_err(|_| {
        "The trusted setup manager is unavailable. Run recovery from the installer.".to_owned()
    })?;
    let manager_directory = manager
        .parent()
        .ok_or_else(|| "The trusted setup manager path is invalid.".to_owned())?;

    if !manager.is_file()
        || manager.file_name().and_then(|name| name.to_str()) != Some(MANAGER_FILE_NAME)
        || !is_within(&local_root, manager_directory)
        || manager_directory.file_name().and_then(|name| name.to_str())
            != Some(MANAGER_DIRECTORY_NAME)
    {
        return Err(
            "The trusted setup manager path is invalid. Run recovery from the installer."
                .to_owned(),
        );
    }
    Ok(manager)
}

fn validate_runtime_state(
    data_root: &Path,
    state: RuntimeStateRecord,
) -> Result<RuntimeStateDto, String> {
    let variant = RuntimeVariant::from_state(&state.variant)
        .ok_or_else(|| "The runtime variant is invalid.".to_owned())?;
    if state.schema != 1
        || !state.status.eq_ignore_ascii_case("active")
        || state.product != "VRCNT"
        || state.version.trim().is_empty()
        || state.architecture != "x64"
        || state.marker_build_identity.trim().is_empty()
        || state.updated_at_utc.trim().is_empty()
        || !is_sha256(&state.marker_sha256)
    {
        return Err("The runtime state is invalid.".to_owned());
    }

    let install_path = canonical_install_path(&state.install_path)?;
    if is_within(data_root, &install_path) || is_within(&install_path, data_root) {
        return Err("The runtime installation overlaps the user data root.".to_owned());
    }
    if !install_path.join("VRCNT.exe").is_file()
        || !install_path.join("VRCNT-backend.exe").is_file()
    {
        return Err("The installed runtime files are missing.".to_owned());
    }

    let marker_path = install_path.join(RUNTIME_MARKER_FILE_NAME);
    let marker_bytes =
        fs::read(&marker_path).map_err(|_| "The runtime marker is missing.".to_owned())?;
    let marker: RuntimeMarker = serde_json::from_slice(&marker_bytes)
        .map_err(|_| "The runtime marker is malformed.".to_owned())?;
    let marker_hash = format!("{:x}", Sha256::digest(&marker_bytes));
    if marker.product != state.product
        || marker.version != state.version
        || RuntimeVariant::from_state(&marker.variant) != Some(variant)
        || marker.architecture != state.architecture
        || marker.build_identity != state.marker_build_identity
        || !marker_hash.eq_ignore_ascii_case(&state.marker_sha256)
    {
        return Err("The runtime marker does not match the saved state.".to_owned());
    }

    Ok(RuntimeStateDto {
        schema: state.schema,
        status: "active".to_owned(),
        product: state.product,
        version: state.version,
        variant: variant.as_str().to_owned(),
        architecture: state.architecture,
        install_path: install_path.display().to_string(),
        updated_at_utc: state.updated_at_utc,
    })
}

fn validate_data_root(data_root: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(data_root)
        .map_err(|_| "The runtime data root is unavailable.".to_owned())?;
    if !root.is_dir() || root.file_name().and_then(|name| name.to_str()) != Some(DATA_ROOT_NAME) {
        return Err("The runtime data root is invalid.".to_owned());
    }
    Ok(root)
}

fn canonical_install_path(raw_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw_path);
    if !path.is_absolute() {
        return Err("The runtime install path is invalid.".to_owned());
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|_| "The runtime install path is unavailable.".to_owned())?;
    if !canonical.is_dir() || canonical.parent().is_none() || !paths_equal(&path, &canonical) {
        return Err("The runtime install path is not canonical.".to_owned());
    }
    Ok(canonical)
}

fn validate_current_app_path(install_path: &Path) -> Result<(), String> {
    let current_executable = env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|_| "The current VRCNT executable could not be validated.".to_owned())?;
    let expected_executable = fs::canonicalize(install_path.join("VRCNT.exe"))
        .map_err(|_| "The installed VRCNT executable is unavailable.".to_owned())?;
    if !paths_equal(&current_executable, &expected_executable) {
        return Err(
            "Runtime switching must be launched by the active installed VRCNT runtime.".to_owned(),
        );
    }
    Ok(())
}

fn is_within(parent: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(parent).is_ok()
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        let normalize = |path: &Path| {
            path.as_os_str()
                .to_string_lossy()
                .strip_prefix(r"\\?\")
                .unwrap_or(&path.as_os_str().to_string_lossy())
                .trim_end_matches(['\\', '/'])
                .to_owned()
        };
        normalize(left).eq_ignore_ascii_case(&normalize(right))
    } else {
        left == right
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|character| character.is_ascii_hexdigit())
}

fn recovery_state() -> RuntimeStateDto {
    RuntimeStateDto {
        schema: 1,
        status: "recovery".to_owned(),
        product: "VRCNT".to_owned(),
        version: String::new(),
        variant: String::new(),
        architecture: String::new(),
        install_path: String::new(),
        updated_at_utc: String::new(),
    }
}
