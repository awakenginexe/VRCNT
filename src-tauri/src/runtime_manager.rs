use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::Emitter;

const DATA_ROOT_NAME: &str = "VRCNTData";
const MANAGER_DIRECTORY_NAME: &str = "VRCNTInstaller";
const MANAGER_FILE_NAME: &str = "VRCNT.Setup.exe";
const RUNTIME_STATE_FILE_NAME: &str = "runtime.json";
const RUNTIME_MARKER_FILE_NAME: &str = "VRCNT.runtime.json";
const RUNTIME_SWITCH_STATUS_FILE_NAME: &str = "runtime-switch-status.json";
const MANAGER_STATE_FILE_NAME: &str = "manager-state.json";
const MANAGER_SIGNATURE_FILE_NAME: &str = "VRCNT.Setup.exe.sig";
const MINISIGN_FILE_NAME: &str = "minisign.exe";
const MINISIGN_SHA256: &str = "5535be9e4e123831ebe6ef324aafe9dde507015c176191f9e20c3ad60567f9e1";
const MINISIGN_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK";
const RUNTIME_SWITCH_REQUESTED_EVENT: &str = "vrcnt://runtime-switch-requested";
const MANAGER_VERSION: &str = "5.15.0";
const MANAGER_PROTOCOL: u32 = 1;
const MANIFEST_SCHEMA: u32 = 1;
const RUNTIME_STATE_SCHEMA: u32 = 1;
const ACTIVATION_PROTOCOL: u32 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSwitchEvent {
    pub nonce: String,
    pub token: String,
    pub target_variant: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeSwitchHandoff {
    pub nonce: String,
    pub token: String,
    pub target_variant: String,
    pub proof: String,
    pub status_path: PathBuf,
    pub current_app_path: PathBuf,
}

#[derive(Debug, Default)]
pub struct RuntimeSwitchState {
    handoff: Mutex<Option<RuntimeSwitchHandoff>>,
    shutdown_authorized: std::sync::atomic::AtomicBool,
}

impl RuntimeSwitchState {
    pub fn new() -> Self {
        Self::default()
    }

    fn begin(&self, handoff: RuntimeSwitchHandoff) -> Result<(), String> {
        let mut current = self
            .handoff
            .lock()
            .map_err(|_| "Runtime switch state is unavailable.".to_owned())?;
        if current.is_some() {
            return Err("A runtime switch is already in progress.".to_owned());
        }
        *current = Some(handoff);
        self.shutdown_authorized
            .store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn authorize_shutdown(&self, nonce: &str, token: &str) -> Result<(), String> {
        let current = self
            .handoff
            .lock()
            .map_err(|_| "Runtime switch state is unavailable.".to_owned())?;
        let Some(handoff) = current.as_ref() else {
            return Err("No authenticated runtime switch is pending.".to_owned());
        };
        if handoff.nonce != nonce || handoff.token != token {
            return Err("The runtime switch shutdown proof is invalid.".to_owned());
        }
        self.shutdown_authorized
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    pub fn is_shutdown_authorized(&self) -> bool {
        self.shutdown_authorized
            .load(std::sync::atomic::Ordering::SeqCst)
            || self
                .handoff
                .lock()
                .map(|handoff| handoff.is_some())
                .unwrap_or(false)
    }
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStateRecord {
    #[serde(alias = "ManagerPath")]
    manager_path: String,
    #[serde(alias = "ManagerSha256")]
    manager_sha256: String,
    #[serde(alias = "Version")]
    version: String,
    #[serde(alias = "ManagerProtocol")]
    manager_protocol: u32,
    #[serde(alias = "ManifestSchema")]
    manifest_schema: u32,
    #[serde(alias = "RuntimeStateSchema")]
    runtime_state_schema: u32,
    #[serde(alias = "ActivationProtocol")]
    activation_protocol: u32,
    #[serde(alias = "LastSelfCheckSucceeded")]
    last_self_check_succeeded: bool,
    #[serde(alias = "UpdatedAtUtc")]
    updated_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSwitchStatusDto {
    pub status: String,
    pub target_variant: Option<String>,
    pub nonce: Option<String>,
    pub error_code: Option<String>,
    pub message: Option<String>,
    pub updated_at_utc: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSwitchStatusRecord {
    schema: u32,
    status: String,
    target_variant: String,
    nonce: String,
    token_sha256: String,
    proof_sha256: String,
    current_app_path: String,
    error_code: Option<String>,
    message: Option<String>,
    updated_at_utc: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSwitchStatusRecordForWrite<'a> {
    schema: u32,
    status: &'a str,
    target_variant: &'a str,
    nonce: &'a str,
    token_sha256: &'a str,
    proof_sha256: &'a str,
    current_app_path: &'a Path,
    error_code: Option<&'a str>,
    message: Option<&'a str>,
}

#[tauri::command]
pub fn get_runtime_state() -> Result<RuntimeStateDto, String> {
    let Some(data_root) = resolve_data_root() else {
        return Ok(recovery_state());
    };
    read_runtime_state_from_data_root(&data_root)
}

#[tauri::command]
pub fn launch_runtime_switch(
    app: tauri::AppHandle,
    switch_state: tauri::State<'_, RuntimeSwitchState>,
    variant: String,
) -> Result<(), String> {
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

    let current_app = fs::canonicalize(install_path.join("VRCNT.exe"))
        .map_err(|_| "The active VRCNT executable is unavailable.".to_owned())?;
    let nonce = new_secret("runtime-switch-nonce");
    let token = new_secret("runtime-switch-token");
    let proof = switch_proof(&token, &nonce, target.as_str(), &current_app);
    let status_path = data_root.join(RUNTIME_SWITCH_STATUS_FILE_NAME);
    write_switch_status(
        &status_path,
        &RuntimeSwitchStatusRecordForWrite {
            schema: 1,
            status: "pending",
            target_variant: target.as_str(),
            nonce: &nonce,
            token_sha256: &hash(&token),
            proof_sha256: &proof,
            current_app_path: &current_app,
            error_code: None,
            message: None,
        },
    )?;
    switch_state.begin(RuntimeSwitchHandoff {
        nonce: nonce.clone(),
        token: token.clone(),
        target_variant: target.as_str().to_owned(),
        proof,
        status_path: status_path.clone(),
        current_app_path: current_app.clone(),
    })?;

    let mut command = Command::new(&manager_path);
    command
        .current_dir(manager_directory)
        .arg("--switch")
        .arg("--variant")
        .arg(target.as_str())
        .arg("--install-path")
        .arg(&state.install_path)
        .arg("--current-app")
        .arg(&current_app)
        .arg("--switch-token")
        .arg(&token)
        .arg("--switch-status")
        .arg(&status_path);
    if command.spawn().is_err() {
        let _ = write_switch_terminal(
            &status_path,
            "failed",
            target.as_str(),
            &nonce,
            &hash(&token),
            &current_app,
            &switch_proof(&token, &nonce, target.as_str(), &current_app),
            Some("manager_spawn_failed"),
            Some("The setup manager could not be started."),
        );
        return Err(
            "VRCNT could not launch the trusted setup manager. Run Setup recovery and try again."
                .to_owned(),
        );
    }
    app.emit(
        RUNTIME_SWITCH_REQUESTED_EVENT,
        RuntimeSwitchEvent {
            nonce,
            token,
            target_variant: target.as_str().to_owned(),
        },
    )
    .map_err(|_| "The runtime switch shutdown handoff could not be delivered.".to_owned())?;

    Ok(())
}

#[tauri::command]
pub fn complete_runtime_switch_shutdown(
    app: tauri::AppHandle,
    switch_state: tauri::State<'_, RuntimeSwitchState>,
    nonce: String,
    token: String,
) -> Result<(), String> {
    switch_state.authorize_shutdown(&nonce, &token)?;
    app.get_webview_window("main")
        .ok_or_else(|| "VRCNT main window is unavailable.".to_owned())?
        .close()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_runtime_switch_status() -> Result<RuntimeSwitchStatusDto, String> {
    let Some(data_root) = resolve_data_root() else {
        return Ok(idle_switch_status());
    };
    let status_path = data_root.join(RUNTIME_SWITCH_STATUS_FILE_NAME);
    let contents = match fs::read(&status_path) {
        Ok(contents) => contents,
        Err(_) => return Ok(idle_switch_status()),
    };
    let status: RuntimeSwitchStatusRecord = match serde_json::from_slice(&contents) {
        Ok(status) => status,
        Err(_) => return Ok(stale_switch_status("malformed_switch_status")),
    };
    if status.schema != 1
        || RuntimeVariant::parse(&status.target_variant).is_err()
        || status.nonce.trim().is_empty()
        || !is_sha256(&status.token_sha256)
        || status.current_app_path.trim().is_empty()
    {
        return Ok(stale_switch_status("invalid_switch_status"));
    }
    if !matches!(
        status.status.as_str(),
        "pending" | "accepted" | "running" | "succeeded" | "failed" | "cancelled" | "stale"
    ) {
        return Ok(stale_switch_status("unknown_switch_status"));
    }
    Ok(RuntimeSwitchStatusDto {
        status: status.status,
        target_variant: Some(status.target_variant),
        nonce: Some(status.nonce),
        error_code: status.error_code,
        message: status.message,
        updated_at_utc: Some(status.updated_at_utc),
    })
}

fn idle_switch_status() -> RuntimeSwitchStatusDto {
    RuntimeSwitchStatusDto {
        status: "idle".to_owned(),
        target_variant: None,
        nonce: None,
        error_code: None,
        message: None,
        updated_at_utc: None,
    }
}

fn stale_switch_status(code: &str) -> RuntimeSwitchStatusDto {
    RuntimeSwitchStatusDto {
        status: "stale".to_owned(),
        target_variant: None,
        nonce: None,
        error_code: Some(code.to_owned()),
        message: Some("Runtime switch recovery is required.".to_owned()),
        updated_at_utc: None,
    }
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

fn write_switch_status(
    path: &Path,
    status: &RuntimeSwitchStatusRecordForWrite<'_>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The runtime switch status path is invalid.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|_| "The runtime switch status directory is unavailable.".to_owned())?;
    let temporary = parent.join(format!(
        "runtime-switch-status.{}.tmp",
        new_secret("status")
    ));
    let mut value = serde_json::to_value(status)
        .map_err(|_| "The runtime switch status could not be serialized.".to_owned())?;
    value["updatedAtUtc"] = serde_json::Value::String(format_time(SystemTime::now()));
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|_| "The runtime switch status could not be serialized.".to_owned())?;
    if fs::write(&temporary, bytes).is_err() {
        return Err("The runtime switch status could not be written.".to_owned());
    }
    fs::rename(&temporary, path).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        "The runtime switch status could not be committed.".to_owned()
    })
}

fn write_switch_terminal(
    path: &Path,
    status: &str,
    target: &str,
    nonce: &str,
    token_hash: &str,
    app_path: &Path,
    proof: &str,
    error_code: Option<&str>,
    message: Option<&str>,
) -> Result<(), String> {
    write_switch_status(
        path,
        &RuntimeSwitchStatusRecordForWrite {
            schema: 1,
            status,
            target_variant: target,
            nonce,
            token_sha256: token_hash,
            proof_sha256: proof,
            current_app_path: app_path,
            error_code,
            message,
        },
    )
}

fn format_time(time: SystemTime) -> String {
    let duration = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = duration.as_secs() as i64;
    let days = seconds / 86_400;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        day_seconds / 3_600,
        day_seconds / 60 % 60,
        day_seconds % 60,
        duration.subsec_millis()
    )
}

fn new_secret(label: &str) -> String {
    let seed = format!(
        "{label}:{}:{}:{}",
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        std::process::id(),
        env::current_exe().ok().unwrap_or_default().display()
    );
    hash(&seed)
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn switch_proof(token: &str, nonce: &str, target: &str, current_app: &Path) -> String {
    hash(&format!(
        "{token}\n{nonce}\n{target}\n{}",
        current_app.display()
    ))
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
    validate_promoted_manager(&manager, manager_directory)?;
    Ok(manager)
}

fn validate_promoted_manager(manager: &Path, manager_directory: &Path) -> Result<(), String> {
    let state_path = manager_directory.join(MANAGER_STATE_FILE_NAME);
    let signature_path = manager_directory.join(MANAGER_SIGNATURE_FILE_NAME);
    let state_bytes = fs::read(&state_path).map_err(|_| {
        "The setup manager is not authenticated. Run Setup recovery and try again.".to_owned()
    })?;
    let state: ManagerStateRecord = serde_json::from_slice(&state_bytes).map_err(|_| {
        "The setup manager state is malformed. Run Setup recovery and try again.".to_owned()
    })?;
    let canonical_manager = fs::canonicalize(manager)
        .map_err(|_| "The setup manager executable is unavailable.".to_owned())?;
    let recorded_manager = fs::canonicalize(&state.manager_path).map_err(|_| {
        "The setup manager identity is stale. Run Setup recovery and try again.".to_owned()
    })?;
    if !paths_equal(&canonical_manager, &recorded_manager)
        || !state.last_self_check_succeeded
        || state.version != MANAGER_VERSION
        || state.manager_protocol != MANAGER_PROTOCOL
        || state.manifest_schema != MANIFEST_SCHEMA
        || state.runtime_state_schema != RUNTIME_STATE_SCHEMA
        || state.activation_protocol != ACTIVATION_PROTOCOL
        || !is_sha256(&state.manager_sha256)
        || !is_recent(&state.updated_at_utc)
    {
        return Err("The setup manager capabilities or identity are incompatible. Run Setup recovery and try again.".to_owned());
    }
    let manager_bytes =
        fs::read(manager).map_err(|_| "The setup manager executable is unavailable.".to_owned())?;
    if hash_bytes(&manager_bytes) != state.manager_sha256.to_ascii_lowercase() {
        return Err("The setup manager hash does not match its authenticated state. Run Setup recovery and try again.".to_owned());
    }
    let signature = fs::read_to_string(signature_path).map_err(|_| {
        "The setup manager signature is missing. Run Setup recovery and try again.".to_owned()
    })?;
    if signature.trim().is_empty() {
        return Err(
            "The setup manager signature is empty. Run Setup recovery and try again.".to_owned(),
        );
    }
    validate_manager_signature(manager, manager_directory, &signature)?;
    Ok(())
}

fn validate_manager_signature(
    manager: &Path,
    manager_directory: &Path,
    encoded_signature: &str,
) -> Result<(), String> {
    let minisign = manager_directory.join(MINISIGN_FILE_NAME);
    let minisign_bytes = fs::read(&minisign).map_err(|_| {
        "The authenticated signature verifier is missing. Run Setup recovery and try again."
            .to_owned()
    })?;
    if hash_bytes(&minisign_bytes) != MINISIGN_SHA256 {
        return Err(
            "The authenticated signature verifier is tampered. Run Setup recovery and try again."
                .to_owned(),
        );
    }
    let check_directory =
        manager_directory.join(format!(".manager-check-{}", new_secret("manager-check")));
    fs::create_dir(&check_directory).map_err(|_| {
        "The manager signature check could not start. Run Setup recovery and try again.".to_owned()
    })?;
    let signature_path = check_directory.join("manager.minisig");
    let public_key_path = check_directory.join("manager.pub");
    let result = (|| {
        let signature_bytes = BASE64
            .decode(encoded_signature.trim().trim_start_matches('\u{feff}'))
            .map_err(|_| {
                "The setup manager signature is malformed. Run Setup recovery and try again."
                    .to_owned()
            })?;
        let public_key = BASE64
            .decode(MINISIGN_PUBLIC_KEY)
            .map_err(|_| "The embedded setup manager key is malformed.".to_owned())?;
        fs::write(&signature_path, signature_bytes)
            .map_err(|_| "The setup manager signature could not be staged.".to_owned())?;
        fs::write(&public_key_path, public_key)
            .map_err(|_| "The embedded setup manager key could not be staged.".to_owned())?;
        let status = Command::new(&minisign)
            .arg("-Vm")
            .arg(manager)
            .arg("-x")
            .arg(&signature_path)
            .arg("-p")
            .arg(&public_key_path)
            .arg("-q")
            .status()
            .map_err(|_| "The setup manager signature verifier could not run.".to_owned())?;
        if status.success() {
            Ok(())
        } else {
            Err(
                "The setup manager signature is invalid. Run Setup recovery and try again."
                    .to_owned(),
            )
        }
    })();
    let _ = fs::remove_dir_all(&check_directory);
    result
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

fn hash_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

fn is_recent(value: &str) -> bool {
    let Some((date, time)) = value.split_once('T') else {
        return false;
    };
    let date_parts = date
        .split('-')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect::<Vec<_>>();
    let time_core = time.split(['.', '+', '-']).next().unwrap_or_default();
    let time_parts = time_core
        .trim_end_matches('Z')
        .split(':')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect::<Vec<_>>();
    if date_parts.len() != 3
        || time_parts.len() != 3
        || date_parts[1] == 0
        || date_parts[1] > 12
        || date_parts[2] == 0
        || date_parts[2] > 31
        || time_parts[0] > 23
        || time_parts[1] > 59
        || time_parts[2] > 60
    {
        return false;
    }
    let days = days_from_civil(date_parts[0], date_parts[1] as u32, date_parts[2] as u32);
    let timestamp = days * 86_400 + time_parts[0] * 3_600 + time_parts[1] * 60 + time_parts[2];
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    timestamp <= now + 300 && now.saturating_sub(timestamp) <= 90 * 86_400
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (
        year + if month <= 2 { 1 } else { 0 },
        month as u32,
        day as u32,
    )
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
