use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::{Hmac, Mac};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
#[cfg(not(windows))]
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

const DATA_ROOT_NAME: &str = "VRCNTData";
const MANAGER_DIRECTORY_NAME: &str = "VRCNTInstaller";
const MANAGER_FILE_NAME: &str = "VRCNT.Setup.exe";
const RUNTIME_STATE_FILE_NAME: &str = "runtime.json";
const RUNTIME_MARKER_FILE_NAME: &str = "VRCNT.runtime.json";
const RUNTIME_SWITCH_STATUS_FILE_NAME: &str = "runtime-switch-status.json";
const RUNTIME_SWITCH_RETRY_CLEAR_FILE_NAME: &str = "runtime-switch-retry-clear.json";
const MANAGER_STATE_FILE_NAME: &str = "manager-state.json";
const MANAGER_SIGNATURE_FILE_NAME: &str = "VRCNT.Setup.exe.sig";
const MINISIGN_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK";
const RUNTIME_RELEASE_TAG: &str = match option_env!("VRCNT_RUNTIME_RELEASE_TAG") {
    Some(value) => value,
    None => "v5.15.0",
};
const RELEASE_DOWNLOAD_ROOT: &str = "https://github.com/awakenginexe/VRCNT/releases/download/";
const RUNTIME_SWITCH_REQUESTED_EVENT: &str = "vrcnt://runtime-switch-requested";
const MANAGER_VERSION: &str = "5.15.0";
const MANAGER_PROTOCOL: u32 = 1;
const MANIFEST_SCHEMA: u32 = 2;
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
    pub install_path: PathBuf,
    pub lease_generation: u64,
}

#[derive(Debug, Default)]
pub struct RuntimeSwitchState {
    handoff: Mutex<Option<RuntimeSwitchHandoff>>,
    shutdown_authorized: std::sync::atomic::AtomicBool,
    shutdown_requested: std::sync::atomic::AtomicBool,
    shutdown_request_delivered: std::sync::atomic::AtomicBool,
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
        self.shutdown_requested
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.shutdown_request_delivered
            .store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn recover_abandoned_pre_quiesce_handoff(&self) -> Result<bool, String> {
        self.recover_abandoned_pre_quiesce_handoff_with_after_recovery(|| {})
    }

    fn recover_abandoned_pre_quiesce_handoff_with_after_recovery<F>(
        &self,
        after_recovery: F,
    ) -> Result<bool, String>
    where
        F: FnOnce(),
    {
        let handoff = self
            .handoff
            .lock()
            .map_err(|_| "Runtime switch state is unavailable.".to_owned())?
            .clone();
        let Some(handoff) = handoff else {
            return Ok(false);
        };
        if self.consume_matching_retry_clear(&handoff)? {
            return Ok(true);
        }
        let recovered =
            recover_abandoned_runtime_switch(&handoff, SystemTime::now(), is_process_alive)?;
        if recovered {
            after_recovery();
            let _ = self.clear_if_matches(&handoff)?;
            return Ok(true);
        }
        let terminal = read_runtime_switch_status(&handoff.status_path)
            .ok()
            .filter(|status| {
                matches!(
                    status.status.as_str(),
                    "succeeded" | "failed" | "cancelled" | "stale"
                ) && handoff_matches_record(&handoff, status)
            });
        if let Some(terminal) = terminal {
            return self.clear_if_owns_status(&terminal);
        }
        Ok(false)
    }

    fn consume_matching_retry_clear(&self, handoff: &RuntimeSwitchHandoff) -> Result<bool, String> {
        with_runtime_switch_lock(&handoff.status_path, || {
            if handoff.status_path.exists() {
                return Ok(false);
            }
            let retry_clear_path = runtime_switch_retry_clear_path(&handoff.status_path)?;
            let clear = match read_runtime_switch_retry_clear_unlocked(&retry_clear_path) {
                Ok(clear) => clear,
                Err(_) => return Ok(false),
            };
            if !handoff_matches_retry_clear(handoff, &clear) {
                return Ok(false);
            }
            let mut current = self
                .handoff
                .lock()
                .map_err(|_| "Runtime switch state is unavailable.".to_owned())?;
            if current
                .as_ref()
                .map(|active| handoffs_match(active, handoff))
                != Some(true)
            {
                return Ok(false);
            }
            *current = None;
            self.shutdown_authorized
                .store(false, std::sync::atomic::Ordering::SeqCst);
            self.shutdown_requested
                .store(false, std::sync::atomic::Ordering::SeqCst);
            self.shutdown_request_delivered
                .store(false, std::sync::atomic::Ordering::SeqCst);
            Ok(true)
        })
    }

    fn verify_shutdown_acknowledgement(
        &self,
        nonce: &str,
        token: &str,
    ) -> Result<RuntimeSwitchHandoff, String> {
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
        if !self
            .shutdown_requested
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err("The runtime switch manager has not requested shutdown.".to_owned());
        }
        Ok(handoff.clone())
    }

    fn authorize_shutdown(&self) {
        self.shutdown_authorized
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn is_shutdown_authorized(&self) -> bool {
        self.shutdown_authorized
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    fn deliver_shutdown_request(
        &self,
        status: &RuntimeSwitchStatusRecord,
    ) -> Result<Option<RuntimeSwitchEvent>, String> {
        let current = self
            .handoff
            .lock()
            .map_err(|_| "Runtime switch state is unavailable.".to_owned())?;
        let Some(handoff) = current.as_ref() else {
            return Ok(None);
        };
        if status.status != "shutdown_requested"
            || status.nonce != handoff.nonce
            || status.target_variant != handoff.target_variant
            || status.lease_generation != handoff.lease_generation
            || status.token_sha256 != hash(&handoff.token)
            || status.proof_sha256 != handoff.proof
            || !paths_equal(
                Path::new(&status.current_app_path),
                &handoff.current_app_path,
            )
            || !paths_equal(Path::new(&status.install_path), &handoff.install_path)
        {
            return Err("The runtime switch shutdown request is unauthenticated.".to_owned());
        }
        self.shutdown_requested
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if self
            .shutdown_request_delivered
            .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            return Ok(None);
        }
        Ok(Some(RuntimeSwitchEvent {
            nonce: handoff.nonce.clone(),
            token: handoff.token.clone(),
            target_variant: handoff.target_variant.clone(),
        }))
    }

    fn clear_if_matches(&self, expected: &RuntimeSwitchHandoff) -> Result<bool, String> {
        let mut current = self
            .handoff
            .lock()
            .map_err(|_| "Runtime switch state is unavailable.".to_owned())?;
        if current
            .as_ref()
            .map(|active| handoffs_match(active, expected))
            != Some(true)
        {
            return Ok(false);
        }
        *current = None;
        self.shutdown_authorized
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.shutdown_requested
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.shutdown_request_delivered
            .store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    }

    fn clear_if_owns_status(&self, status: &RuntimeSwitchStatusRecord) -> Result<bool, String> {
        let mut current = self
            .handoff
            .lock()
            .map_err(|_| "Runtime switch state is unavailable.".to_owned())?;
        if current
            .as_ref()
            .map(|handoff| handoff_matches_record(handoff, status))
            != Some(true)
        {
            return Ok(false);
        }
        *current = None;
        self.shutdown_authorized
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.shutdown_requested
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.shutdown_request_delivered
            .store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
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
    #[serde(alias = "Schema")]
    schema: u32,
    #[serde(alias = "Status")]
    status: String,
    #[serde(alias = "Product")]
    product: String,
    #[serde(alias = "Version")]
    version: String,
    #[serde(alias = "Variant")]
    variant: String,
    #[serde(alias = "Architecture")]
    architecture: String,
    #[serde(alias = "InstallPath")]
    install_path: String,
    #[serde(alias = "MarkerBuildIdentity")]
    marker_build_identity: String,
    #[serde(alias = "MarkerSha256")]
    marker_sha256: String,
    #[serde(alias = "UpdatedAtUtc")]
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryPackageManifest {
    schema: u32,
    product: String,
    version: String,
    architecture: String,
    bootstrapper: RecoveryBootstrapper,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryBootstrapper {
    name: String,
    size: u64,
    sha256: String,
    manager_protocol: u32,
    manifest_schema: u32,
    runtime_state_schema: u32,
    activation_protocol: u32,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSwitchStatusRecord {
    schema: u32,
    status: String,
    target_variant: String,
    nonce: String,
    token_sha256: String,
    proof_sha256: String,
    current_app_path: String,
    install_path: String,
    error_code: Option<String>,
    message: Option<String>,
    updated_at_utc: String,
    #[serde(default)]
    manager_process_id: Option<u32>,
    #[serde(default)]
    handoff_expires_at_utc: Option<String>,
    #[serde(default)]
    receipt_mac: Option<String>,
    #[serde(default)]
    receipt_expires_at_unix_ms: Option<i64>,
    #[serde(default)]
    consumed_at_utc: Option<String>,
    #[serde(default)]
    lease_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSwitchRetryClearRecord {
    schema: u32,
    nonce: String,
    target_variant: String,
    token_sha256: String,
    proof_sha256: String,
    current_app_path: String,
    install_path: String,
    lease_generation: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtectedReceiptBindingRecord {
    schema: u32,
    nonce: String,
    protected_binding: String,
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
    install_path: &'a Path,
    error_code: Option<&'a str>,
    message: Option<&'a str>,
    manager_process_id: Option<u32>,
    handoff_expires_at_utc: Option<String>,
    lease_generation: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSwitchRetryClearRecordForWrite<'a> {
    schema: u32,
    nonce: &'a str,
    target_variant: &'a str,
    token_sha256: &'a str,
    proof_sha256: &'a str,
    current_app_path: &'a Path,
    install_path: &'a Path,
    lease_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSwitchReceiptBinding {
    pub schema: u32,
    pub nonce: String,
    pub target_variant: String,
    pub install_path: PathBuf,
    pub current_app_path: PathBuf,
    pub token: String,
    pub token_sha256: String,
    pub proof_sha256: String,
    pub lease_generation: u64,
    pub receipt_secret: String,
    pub receipt_expires_at_unix_ms: i64,
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
    switch_state.recover_abandoned_pre_quiesce_handoff()?;
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
    let handoff = begin_runtime_switch(&data_root, target.as_str(), &install_path, &current_app)?;
    let token = handoff.token.clone();
    let status_path = handoff.status_path.clone();
    switch_state.begin(handoff.clone())?;

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
    let child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            let _ = clear_runtime_switch_request(&handoff);
            let _ = switch_state.clear_if_matches(&handoff);
            return Err(
            "VRCNT could not launch the trusted setup manager. Run Setup recovery and try again."
                .to_owned(),
        );
        }
    };
    write_handoff_liveness(
        &status_path,
        &handoff,
        child.id(),
        SystemTime::now() + Duration::from_secs(15 * 60),
    )?;
    Ok(())
}

#[tauri::command]
pub fn complete_runtime_switch_shutdown(
    app: tauri::AppHandle,
    switch_state: tauri::State<'_, RuntimeSwitchState>,
    nonce: String,
    token: String,
) -> Result<(), String> {
    let handoff = switch_state.verify_shutdown_acknowledgement(&nonce, &token)?;
    if let Err(error) = validate_shutdown_request_status(&handoff) {
        let _ = switch_state.clear_if_matches(&handoff);
        return Err(error);
    }
    write_handoff_status(&handoff, "shutdown_acknowledged", None, None)?;
    switch_state.authorize_shutdown();
    app.get_webview_window("main")
        .ok_or_else(|| "VRCNT main window is unavailable.".to_owned())?
        .close()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_runtime_switch_status(
    app: tauri::AppHandle,
    switch_state: tauri::State<'_, RuntimeSwitchState>,
) -> Result<RuntimeSwitchStatusDto, String> {
    let Some(data_root) = resolve_data_root() else {
        return Ok(idle_switch_status());
    };
    let status_path = data_root.join(RUNTIME_SWITCH_STATUS_FILE_NAME);
    let contents = match fs::read(&status_path) {
        Ok(contents) => contents,
        Err(_) => {
            let _ = switch_state.recover_abandoned_pre_quiesce_handoff()?;
            match fs::read(&status_path) {
                Ok(contents) => contents,
                Err(_) => return Ok(idle_switch_status()),
            }
        }
    };
    let status: RuntimeSwitchStatusRecord = match serde_json::from_slice(&contents) {
        Ok(status) => status,
        Err(_) => return Ok(stale_switch_status("malformed_switch_status")),
    };
    if switch_state.recover_abandoned_pre_quiesce_handoff()? {
        return Ok(stale_switch_status("manager_unavailable"));
    }
    if status.schema != 1
        || RuntimeVariant::parse(&status.target_variant).is_err()
        || status.nonce.trim().is_empty()
        || !is_sha256(&status.token_sha256)
        || status.current_app_path.trim().is_empty()
    {
        return Ok(stale_switch_status("invalid_switch_status"));
    }
    if status.consumed_at_utc.is_some() {
        return Ok(idle_switch_status());
    }
    if !matches!(
        status.status.as_str(),
        "pending"
            | "accepted"
            | "running"
            | "shutdown_requested"
            | "shutdown_acknowledged"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "stale"
    ) {
        return Ok(stale_switch_status("unknown_switch_status"));
    }
    if status.status == "shutdown_requested" {
        let event = match switch_state.deliver_shutdown_request(&status) {
            Ok(event) => event,
            Err(error) => return Err(error),
        };
        if let Some(event) = event {
            app.emit(RUNTIME_SWITCH_REQUESTED_EVENT, event)
                .map_err(|_| {
                    "The runtime switch shutdown handoff could not be delivered.".to_owned()
                })?;
        }
    }
    if matches!(
        status.status.as_str(),
        "succeeded" | "failed" | "cancelled" | "stale"
    ) {
        if !switch_state.clear_if_owns_status(&status)? {
            return Ok(stale_switch_status("terminal_receipt_requires_consumption"));
        }
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

#[tauri::command]
pub fn consume_runtime_switch_receipt() -> Result<Option<RuntimeSwitchStatusDto>, String> {
    let Some(data_root) = resolve_data_root() else {
        return Ok(None);
    };
    let state = read_runtime_state_from_data_root(&data_root)?;
    if state.status != "active" {
        return Err(
            "Runtime recovery is required before the switch result can be consumed.".to_owned(),
        );
    }
    let install_path = PathBuf::from(state.install_path);
    validate_current_app_path(&install_path)?;
    let current_app = fs::canonicalize(install_path.join("VRCNT.exe"))
        .map_err(|_| "The installed VRCNT executable is unavailable.".to_owned())?;
    consume_runtime_switch_receipt_at(&data_root, &current_app, SystemTime::now())
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

fn with_runtime_switch_lock<T, F>(status_path: &Path, action: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let data_root = status_path
        .parent()
        .ok_or_else(|| "The runtime switch status path is invalid.".to_owned())?;
    #[cfg(windows)]
    {
        let lock_identity = data_root.display().to_string().to_ascii_uppercase();
        return with_named_mutex(
            &format!("Local\\VRCNT.RuntimeSwitch.{}", hash(&lock_identity)),
            action,
        );
    }
    #[cfg(not(windows))]
    {
        use fs2::FileExt;
        let lock_path = PathBuf::from(format!("{}.lock", status_path.display()));
        fs::create_dir_all(data_root)
            .map_err(|_| "The runtime switch status directory is unavailable.".to_owned())?;
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(lock_path)
            .map_err(|_| "The runtime switch lock is unavailable.".to_owned())?;
        lock.lock_exclusive()
            .map_err(|_| "The runtime switch lock is unavailable.".to_owned())?;
        let result = action();
        let _ = lock.unlock();
        result
    }
}

#[cfg(windows)]
fn with_named_mutex<T, F>(name: &str, action: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    use std::os::windows::ffi::OsStrExt;
    let name = std::ffi::OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return Err("The runtime switch lock is unavailable.".to_owned());
    }
    let wait = unsafe { WaitForSingleObject(handle, u32::MAX) };
    if wait != 0 && wait != 0x80 {
        unsafe {
            CloseHandle(handle);
        }
        return Err("The runtime switch lock is unavailable.".to_owned());
    }
    let result = action();
    unsafe {
        ReleaseMutex(handle);
        CloseHandle(handle);
    }
    result
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(
        attributes: *const std::ffi::c_void,
        owner: i32,
        name: *const u16,
    ) -> *mut std::ffi::c_void;
    fn WaitForSingleObject(handle: *mut std::ffi::c_void, milliseconds: u32) -> u32;
    fn ReleaseMutex(handle: *mut std::ffi::c_void) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}

fn write_switch_status_unlocked(
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

fn write_handoff_status(
    handoff: &RuntimeSwitchHandoff,
    status: &str,
    error_code: Option<&str>,
    message: Option<&str>,
) -> Result<(), String> {
    with_runtime_switch_lock(&handoff.status_path, || {
        let mut current = read_runtime_switch_status(&handoff.status_path)?;
        if !handoff_matches_record(handoff, &current) {
            return Err("The runtime switch lease was revoked or replaced.".to_owned());
        }
        if !matches!(
            current.status.as_str(),
            "pending" | "accepted" | "running" | "shutdown_requested"
        ) {
            return Err("The runtime switch lease is no longer active.".to_owned());
        }
        current.status = status.to_owned();
        current.error_code = error_code.map(str::to_owned);
        current.message = message.map(str::to_owned);
        current.updated_at_utc = format_time(SystemTime::now());
        write_runtime_switch_status_record_unlocked(&handoff.status_path, &current)
    })
}

pub fn recover_abandoned_runtime_switch<F>(
    handoff: &RuntimeSwitchHandoff,
    now: SystemTime,
    manager_is_alive: F,
) -> Result<bool, String>
where
    F: Fn(u32) -> bool,
{
    recover_abandoned_runtime_switch_with_before_commit(handoff, now, manager_is_alive, || {})
}

#[doc(hidden)]
pub fn recover_abandoned_runtime_switch_with_before_commit<F, H>(
    handoff: &RuntimeSwitchHandoff,
    now: SystemTime,
    manager_is_alive: F,
    before_commit: H,
) -> Result<bool, String>
where
    F: Fn(u32) -> bool,
    H: FnOnce(),
{
    let candidate = with_runtime_switch_lock(&handoff.status_path, || {
        let record = read_runtime_switch_status(&handoff.status_path)?;
        if !handoff_matches_record(handoff, &record)
            || !matches!(record.status.as_str(), "pending" | "accepted" | "running")
        {
            return Ok(None);
        }
        let expired = record
            .handoff_expires_at_utc
            .as_deref()
            .and_then(parse_unix_millis)
            .map(|expires| system_time_millis(now) > expires)
            .unwrap_or(true);
        let manager_alive = record
            .manager_process_id
            .map(manager_is_alive)
            .unwrap_or(false);
        if manager_alive || (!expired && record.manager_process_id.is_none()) {
            return Ok(None);
        }
        Ok(Some(expired))
    })?;
    let Some(expired) = candidate else {
        return Ok(false);
    };

    // The lease may change after observation and before commit. The second locked read below
    // is the nonce/generation compare-and-swap that prevents revoking a retry or newer manager.
    before_commit();
    with_runtime_switch_lock(&handoff.status_path, || {
        let mut stale = read_runtime_switch_status(&handoff.status_path)?;
        if !handoff_matches_record(handoff, &stale)
            || !matches!(stale.status.as_str(), "pending" | "accepted" | "running")
        {
            return Ok(false);
        }
        stale.status = "stale".to_owned();
        stale.error_code = Some(
            if expired {
                "handoff_expired"
            } else {
                "manager_unavailable"
            }
            .to_owned(),
        );
        stale.message = Some("The runtime switch manager did not reach shutdown. The active runtime remains open and you can retry.".to_owned());
        stale.updated_at_utc = format_time(now);
        stale.manager_process_id = None;
        stale.handoff_expires_at_utc = None;
        write_runtime_switch_status_record_unlocked(&handoff.status_path, &stale)?;
        Ok(true)
    })
}

fn begin_runtime_switch(
    data_root: &Path,
    target: &str,
    install_path: &Path,
    current_app_path: &Path,
) -> Result<RuntimeSwitchHandoff, String> {
    let status_path = data_root.join(RUNTIME_SWITCH_STATUS_FILE_NAME);
    with_runtime_switch_lock(&status_path, || {
        let previous_generation = if status_path.exists() {
            let status = read_runtime_switch_status(&status_path)?;
            if matches!(status.status.as_str(), "succeeded" | "failed" | "cancelled")
                && status.consumed_at_utc.is_none()
                && status.receipt_mac.is_some()
            {
                return Err("The previous runtime switch result must be recovered before starting another switch.".to_owned());
            }
            if matches!(status.status.as_str(), "pending" | "accepted" | "running") {
                let manager_alive = status
                    .manager_process_id
                    .map(is_process_alive)
                    .unwrap_or(false);
                let expired = status
                    .handoff_expires_at_utc
                    .as_deref()
                    .and_then(parse_unix_millis)
                    .map(|expires| system_time_millis(SystemTime::now()) > expires)
                    .unwrap_or(true);
                if manager_alive || !expired && status.manager_process_id.is_some() {
                    return Err("A runtime switch manager is already in progress.".to_owned());
                }
                let mut stale = status;
                stale.status = "stale".to_owned();
                stale.error_code = Some(
                    if expired {
                        "handoff_expired"
                    } else {
                        "manager_unavailable"
                    }
                    .to_owned(),
                );
                stale.message = Some("The runtime switch manager did not reach shutdown. The active runtime remains open and you can retry.".to_owned());
                stale.updated_at_utc = format_time(SystemTime::now());
                stale.manager_process_id = None;
                stale.handoff_expires_at_utc = None;
                let previous_nonce = stale.nonce.clone();
                write_runtime_switch_status_record_unlocked(&status_path, &stale)?;
                let _ = fs::remove_file(runtime_switch_receipt_binding_path(
                    data_root,
                    &previous_nonce,
                )?);
            }
            stale_or_terminal_generation(&status_path)?
        } else {
            let retry_clear_path = runtime_switch_retry_clear_path(&status_path)?;
            let generation = read_runtime_switch_retry_clear_unlocked(&retry_clear_path)
                .ok()
                .filter(|clear| clear.schema == 1)
                .map(|clear| clear.lease_generation)
                .unwrap_or(0);
            let _ = fs::remove_file(retry_clear_path);
            generation
        };
        let lease_generation = previous_generation.saturating_add(1);
        let nonce = new_secret("runtime-switch-nonce");
        let token = new_secret("runtime-switch-token");
        let proof = switch_proof(&token, &nonce, target, current_app_path);
        let receipt_expires = SystemTime::now() + Duration::from_secs(24 * 60 * 60);
        let _binding = persist_runtime_switch_receipt_binding_unlocked(
            data_root,
            &nonce,
            target,
            install_path,
            current_app_path,
            &token,
            &proof,
            lease_generation,
            receipt_expires,
        )?;
        write_switch_status_unlocked(
            &status_path,
            &RuntimeSwitchStatusRecordForWrite {
                schema: 1,
                status: "pending",
                target_variant: target,
                nonce: &nonce,
                token_sha256: &hash(&token),
                proof_sha256: &proof,
                current_app_path,
                install_path,
                error_code: None,
                message: None,
                manager_process_id: None,
                handoff_expires_at_utc: Some(format_time(
                    SystemTime::now() + Duration::from_secs(15 * 60),
                )),
                lease_generation,
            },
        )?;
        Ok(RuntimeSwitchHandoff {
            nonce,
            token,
            target_variant: target.to_owned(),
            proof,
            status_path: status_path.clone(),
            current_app_path: current_app_path.to_path_buf(),
            install_path: install_path.to_path_buf(),
            lease_generation,
        })
    })
}

fn write_handoff_liveness(
    status_path: &Path,
    handoff: &RuntimeSwitchHandoff,
    manager_process_id: u32,
    expires_at: SystemTime,
) -> Result<(), String> {
    with_runtime_switch_lock(status_path, || {
        let mut status = read_runtime_switch_status(status_path)?;
        if !handoff_matches_record(handoff, &status) {
            return Err(
                "The runtime switch handoff changed before the manager could be tracked."
                    .to_owned(),
            );
        }
        if !matches!(status.status.as_str(), "pending" | "accepted" | "running") {
            return Ok(());
        }
        status.manager_process_id = Some(manager_process_id);
        status.handoff_expires_at_utc = Some(format_time(expires_at));
        status.updated_at_utc = format_time(SystemTime::now());
        write_runtime_switch_status_record_unlocked(status_path, &status)
    })
}

fn handoff_matches_record(
    handoff: &RuntimeSwitchHandoff,
    status: &RuntimeSwitchStatusRecord,
) -> bool {
    status.schema == 1
        && status.nonce == handoff.nonce
        && status.target_variant == handoff.target_variant
        && status.lease_generation == handoff.lease_generation
        && status.token_sha256 == hash(&handoff.token)
        && status.proof_sha256 == handoff.proof
        && handoff.proof
            == switch_proof(
                &handoff.token,
                &handoff.nonce,
                &handoff.target_variant,
                &handoff.current_app_path,
            )
        && paths_equal(
            Path::new(&status.current_app_path),
            &handoff.current_app_path,
        )
        && paths_equal(Path::new(&status.install_path), &handoff.install_path)
}

fn handoffs_match(left: &RuntimeSwitchHandoff, right: &RuntimeSwitchHandoff) -> bool {
    left.nonce == right.nonce
        && left.target_variant == right.target_variant
        && left.lease_generation == right.lease_generation
        && left.token == right.token
        && left.proof == right.proof
        && paths_equal(&left.status_path, &right.status_path)
        && paths_equal(&left.current_app_path, &right.current_app_path)
        && paths_equal(&left.install_path, &right.install_path)
}

fn handoff_matches_retry_clear(
    handoff: &RuntimeSwitchHandoff,
    clear: &RuntimeSwitchRetryClearRecord,
) -> bool {
    clear.schema == 1
        && clear.nonce == handoff.nonce
        && clear.target_variant == handoff.target_variant
        && clear.lease_generation == handoff.lease_generation
        && clear.token_sha256 == hash(&handoff.token)
        && clear.proof_sha256 == handoff.proof
        && handoff.proof
            == switch_proof(
                &handoff.token,
                &handoff.nonce,
                &handoff.target_variant,
                &handoff.current_app_path,
            )
        && paths_equal(
            Path::new(&clear.current_app_path),
            &handoff.current_app_path,
        )
        && paths_equal(Path::new(&clear.install_path), &handoff.install_path)
}

fn stale_or_terminal_generation(status_path: &Path) -> Result<u64, String> {
    Ok(read_runtime_switch_status(status_path)?.lease_generation)
}

pub fn persist_runtime_switch_receipt_binding(
    data_root: &Path,
    nonce: &str,
    target_variant: &str,
    install_path: &Path,
    current_app_path: &Path,
    token: &str,
    lease_generation: u64,
    receipt_expires_at: SystemTime,
) -> Result<RuntimeSwitchReceiptBinding, String> {
    let status_path = data_root.join(RUNTIME_SWITCH_STATUS_FILE_NAME);
    with_runtime_switch_lock(&status_path, || {
        let canonical_app_path = fs::canonicalize(current_app_path).map_err(|_| {
            "The runtime switch receipt application path is unavailable.".to_owned()
        })?;
        persist_runtime_switch_receipt_binding_unlocked(
            data_root,
            nonce,
            target_variant,
            install_path,
            current_app_path,
            token,
            &switch_proof(token, nonce, target_variant, &canonical_app_path),
            lease_generation,
            receipt_expires_at,
        )
    })
}

fn persist_runtime_switch_receipt_binding_unlocked(
    data_root: &Path,
    nonce: &str,
    target_variant: &str,
    install_path: &Path,
    current_app_path: &Path,
    token: &str,
    proof: &str,
    lease_generation: u64,
    receipt_expires_at: SystemTime,
) -> Result<RuntimeSwitchReceiptBinding, String> {
    if nonce.trim().is_empty()
        || token.trim().is_empty()
        || !matches!(target_variant, "cpu" | "cuda")
    {
        return Err("The runtime switch receipt binding is invalid.".to_owned());
    }
    let mut secret_bytes = [0u8; 32];
    getrandom::fill(&mut secret_bytes)
        .map_err(|_| "The runtime switch receipt credential could not be generated.".to_owned())?;
    let canonical_install_path = fs::canonicalize(install_path)
        .map_err(|_| "The runtime switch receipt install path is unavailable.".to_owned())?;
    let canonical_app_path = fs::canonicalize(current_app_path)
        .map_err(|_| "The runtime switch receipt application path is unavailable.".to_owned())?;
    if !paths_equal(
        &canonical_install_path,
        canonical_app_path
            .parent()
            .unwrap_or_else(|| Path::new(".")),
    ) || proof != switch_proof(token, nonce, target_variant, &canonical_app_path)
    {
        return Err("The runtime switch receipt binding identity is invalid.".to_owned());
    }
    let binding = RuntimeSwitchReceiptBinding {
        schema: 1,
        nonce: nonce.to_owned(),
        target_variant: target_variant.to_owned(),
        install_path: canonical_install_path,
        current_app_path: canonical_app_path,
        token: token.to_owned(),
        token_sha256: hash(token),
        proof_sha256: proof.to_owned(),
        lease_generation,
        receipt_secret: hex_bytes(&secret_bytes),
        receipt_expires_at_unix_ms: system_time_millis(receipt_expires_at),
    };
    let path = runtime_switch_receipt_binding_path(data_root, nonce)?;
    let protected =
        protect_current_user_secret(&serde_json::to_vec(&binding).map_err(|_| {
            "The runtime switch receipt binding could not be serialized.".to_owned()
        })?)?;
    let record = ProtectedReceiptBindingRecord {
        schema: 1,
        nonce: nonce.to_owned(),
        protected_binding: BASE64.encode(protected),
    };
    write_atomic_json(&path, &record, "runtime-switch-receipt")?;
    Ok(binding)
}

fn clear_runtime_switch_request(handoff: &RuntimeSwitchHandoff) -> Result<(), String> {
    with_runtime_switch_lock(&handoff.status_path, || {
        let status = read_runtime_switch_status(&handoff.status_path)?;
        if !handoff_matches_record(handoff, &status)
            || matches!(
                status.status.as_str(),
                "shutdown_acknowledged" | "succeeded"
            )
        {
            return Err(
                "The runtime switch lease was revoked or has crossed the shutdown boundary."
                    .to_owned(),
            );
        }
        fs::remove_file(&handoff.status_path)
            .map_err(|_| "The runtime switch status could not be cleared.".to_owned())?;
        let data_root = handoff
            .status_path
            .parent()
            .unwrap_or_else(|| Path::new("."));
        let _ = fs::remove_file(runtime_switch_receipt_binding_path(
            data_root,
            &handoff.nonce,
        )?);
        Ok(())
    })
}

pub fn consume_runtime_switch_receipt_at(
    data_root: &Path,
    current_app_path: &Path,
    now: SystemTime,
) -> Result<Option<RuntimeSwitchStatusDto>, String> {
    let status_path = data_root.join(RUNTIME_SWITCH_STATUS_FILE_NAME);
    with_runtime_switch_lock(&status_path, || {
        if !status_path.exists() {
            return Ok(None);
        }
        let mut status = read_runtime_switch_status(&status_path)?;
        if status.consumed_at_utc.is_some() {
            return Ok(None);
        }
        if status.schema != 1
            || !matches!(
                status.status.as_str(),
                "succeeded" | "failed" | "cancelled" | "stale"
            )
            || RuntimeVariant::parse(&status.target_variant).is_err()
            || status.nonce.trim().is_empty()
            || !is_sha256(&status.token_sha256)
            || !is_sha256(&status.proof_sha256)
        {
            return Err("The runtime switch receipt is malformed.".to_owned());
        }
        let issued_at = parse_unix_millis(&status.updated_at_utc)
            .ok_or_else(|| "The runtime switch receipt timestamp is malformed.".to_owned())?;
        let now_ms = system_time_millis(now);
        if issued_at > now_ms + 300_000 {
            return Err("The runtime switch receipt timestamp is invalid.".to_owned());
        }
        let recorded_app = fs::canonicalize(&status.current_app_path).map_err(|_| {
            "The runtime switch receipt application path is unavailable.".to_owned()
        })?;
        let current_app = fs::canonicalize(current_app_path)
            .map_err(|_| "The current VRCNT application path is unavailable.".to_owned())?;
        let recorded_install = fs::canonicalize(&status.install_path)
            .map_err(|_| "The runtime switch receipt install path is unavailable.".to_owned())?;
        if !paths_equal(&recorded_app, &current_app)
            || !paths_equal(
                &recorded_install,
                current_app.parent().unwrap_or_else(|| Path::new(".")),
            )
        {
            return Err("The runtime switch receipt is for a different installation.".to_owned());
        }
        let binding = read_runtime_switch_receipt_binding_unlocked(data_root, &status.nonce)?;
        if binding.nonce != status.nonce
            || binding.target_variant != status.target_variant
            || !paths_equal(&binding.install_path, &recorded_install)
            || !paths_equal(&binding.current_app_path, &recorded_app)
            || binding.token_sha256 != hash(&binding.token)
            || binding.token_sha256 != status.token_sha256
            || binding.proof_sha256
                != switch_proof(
                    &binding.token,
                    &binding.nonce,
                    &binding.target_variant,
                    &binding.current_app_path,
                )
            || binding.proof_sha256 != status.proof_sha256
            || binding.lease_generation != status.lease_generation
        {
            return Err("The runtime switch receipt transaction binding is invalid.".to_owned());
        }
        let expires_at = status
            .receipt_expires_at_unix_ms
            .ok_or_else(|| "The runtime switch receipt expiry is missing.".to_owned())?;
        if expires_at <= now_ms
            || expires_at > issued_at + 24 * 60 * 60 * 1000
            || expires_at > binding.receipt_expires_at_unix_ms
            || !secure_equals(
                status.receipt_mac.as_deref(),
                &runtime_switch_receipt_mac_record(&status, &binding.receipt_secret)?,
            )
        {
            return Err("The runtime switch receipt is expired or unauthenticated.".to_owned());
        }
        status.consumed_at_utc = Some(format_time(now));
        write_runtime_switch_status_record_unlocked(&status_path, &status)?;
        let _ = fs::remove_file(runtime_switch_receipt_binding_path(
            data_root,
            &status.nonce,
        )?);
        Ok(Some(RuntimeSwitchStatusDto {
            status: status.status,
            target_variant: Some(status.target_variant),
            nonce: Some(status.nonce),
            error_code: status.error_code,
            message: status.message,
            updated_at_utc: Some(status.updated_at_utc),
        }))
    })
}

pub fn runtime_switch_receipt_mac(
    record: &serde_json::Value,
    secret: &str,
) -> Result<String, String> {
    let record: RuntimeSwitchStatusRecord = serde_json::from_value(record.clone())
        .map_err(|_| "The runtime switch receipt is malformed.".to_owned())?;
    runtime_switch_receipt_mac_record(&record, secret)
}

fn runtime_switch_receipt_mac_record(
    record: &RuntimeSwitchStatusRecord,
    secret: &str,
) -> Result<String, String> {
    let expiry = record
        .receipt_expires_at_unix_ms
        .ok_or_else(|| "The runtime switch receipt expiry is missing.".to_owned())?;
    let updated = parse_unix_millis(&record.updated_at_utc)
        .ok_or_else(|| "The runtime switch receipt timestamp is malformed.".to_owned())?;
    let current_app = fs::canonicalize(&record.current_app_path)
        .map_err(|_| "The runtime switch receipt application path is unavailable.".to_owned())?;
    let install_path = fs::canonicalize(&record.install_path)
        .map_err(|_| "The runtime switch receipt install path is unavailable.".to_owned())?;
    let payload = format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        record.schema,
        record.status,
        record.target_variant,
        record.nonce,
        record.token_sha256,
        record.proof_sha256,
        current_app.display(),
        install_path.display(),
        record.error_code.as_deref().unwrap_or_default(),
        record.message.as_deref().unwrap_or_default(),
        updated,
        expiry,
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| "The runtime switch receipt secret is invalid.".to_owned())?;
    mac.update(payload.as_bytes());
    Ok(format!("{:x}", mac.finalize().into_bytes()))
}

fn read_runtime_switch_status(path: &Path) -> Result<RuntimeSwitchStatusRecord, String> {
    serde_json::from_slice(
        &fs::read(path).map_err(|_| "The runtime switch status is unavailable.".to_owned())?,
    )
    .map_err(|_| "The runtime switch status is malformed.".to_owned())
}

fn runtime_switch_retry_clear_path(status_path: &Path) -> Result<PathBuf, String> {
    let data_root = status_path
        .parent()
        .ok_or_else(|| "The runtime switch status path is invalid.".to_owned())?;
    Ok(data_root.join(RUNTIME_SWITCH_RETRY_CLEAR_FILE_NAME))
}

fn read_runtime_switch_retry_clear_unlocked(
    path: &Path,
) -> Result<RuntimeSwitchRetryClearRecord, String> {
    serde_json::from_slice(
        &fs::read(path).map_err(|_| "The runtime switch retry clear is unavailable.".to_owned())?,
    )
    .map_err(|_| "The runtime switch retry clear is malformed.".to_owned())
}

fn write_runtime_switch_retry_clear_unlocked(
    handoff: &RuntimeSwitchHandoff,
    clear: &RuntimeSwitchRetryClearRecordForWrite<'_>,
) -> Result<(), String> {
    if clear.schema != 1
        || clear.nonce != handoff.nonce
        || clear.target_variant != handoff.target_variant
        || clear.token_sha256 != hash(&handoff.token)
        || clear.proof_sha256 != handoff.proof
        || clear.lease_generation != handoff.lease_generation
        || !paths_equal(clear.current_app_path, &handoff.current_app_path)
        || !paths_equal(clear.install_path, &handoff.install_path)
    {
        return Err("The runtime switch retry clear does not match the lease.".to_owned());
    }
    write_atomic_json(
        &runtime_switch_retry_clear_path(&handoff.status_path)?,
        clear,
        "runtime-switch-retry-clear",
    )
}

fn write_runtime_switch_status_record(
    path: &Path,
    status: &RuntimeSwitchStatusRecord,
) -> Result<(), String> {
    with_runtime_switch_lock(path, || {
        write_runtime_switch_status_record_unlocked(path, status)
    })
}

fn write_runtime_switch_status_record_unlocked(
    path: &Path,
    status: &RuntimeSwitchStatusRecord,
) -> Result<(), String> {
    write_atomic_json(path, status, "runtime-switch-status")
}

fn write_atomic_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("The {label} path is invalid."))?;
    fs::create_dir_all(parent).map_err(|_| format!("The {label} directory is unavailable."))?;
    let temporary = parent.join(format!(".{label}.{}.tmp", new_secret(label)));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value)
            .map_err(|_| format!("The {label} could not be serialized."))?,
    )
    .map_err(|_| format!("The {label} could not be written."))?;
    fs::rename(&temporary, path).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        format!("The {label} could not be committed.")
    })
}

fn runtime_switch_receipt_binding_path(data_root: &Path, nonce: &str) -> Result<PathBuf, String> {
    if nonce.is_empty()
        || !nonce
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-')
    {
        return Err("The runtime switch receipt nonce is invalid.".to_owned());
    }
    Ok(data_root.join(format!("runtime-switch-receipt-{nonce}.json")))
}

fn read_runtime_switch_receipt_binding_unlocked(
    data_root: &Path,
    nonce: &str,
) -> Result<RuntimeSwitchReceiptBinding, String> {
    let path = runtime_switch_receipt_binding_path(data_root, nonce)?;
    let record: ProtectedReceiptBindingRecord = serde_json::from_slice(
        &fs::read(&path)
            .map_err(|_| "The runtime switch receipt binding is unavailable.".to_owned())?,
    )
    .map_err(|_| "The runtime switch receipt binding is malformed.".to_owned())?;
    if record.schema != 1 || record.nonce != nonce {
        return Err(
            "The runtime switch receipt binding does not match the transaction.".to_owned(),
        );
    }
    let protected = BASE64
        .decode(record.protected_binding)
        .map_err(|_| "The runtime switch receipt binding is malformed.".to_owned())?;
    serde_json::from_slice(&protect_current_user_secret_decode(&protected)?)
        .map_err(|_| "The runtime switch receipt binding is malformed.".to_owned())
}

fn hex_bytes(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn system_time_millis(time: SystemTime) -> i64 {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn is_process_alive(process_id: u32) -> bool {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(process_id)]), true);
    system.process(Pid::from_u32(process_id)).is_some()
}

#[cfg(windows)]
#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[cfg(windows)]
#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        input: *mut DataBlob,
        description: *const u16,
        optional_entropy: *mut DataBlob,
        reserved: *mut std::ffi::c_void,
        prompt_struct: *mut std::ffi::c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        input: *mut DataBlob,
        description: *mut *mut u16,
        optional_entropy: *mut DataBlob,
        reserved: *mut std::ffi::c_void,
        prompt_struct: *mut std::ffi::c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(memory: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[cfg(windows)]
fn protect_current_user_secret(value: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let mut input = DataBlob {
            cb_data: value.len() as u32,
            pb_data: value.as_ptr() as *mut u8,
        };
        let mut output = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };
        if CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            1,
            &mut output,
        ) == 0
        {
            return Err("The runtime switch receipt secret could not be protected.".to_owned());
        }
        let protected =
            std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec();
        let _ = LocalFree(output.pb_data as *mut std::ffi::c_void);
        Ok(protected)
    }
}

#[cfg(windows)]
fn protect_current_user_secret_decode(value: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let mut input = DataBlob {
            cb_data: value.len() as u32,
            pb_data: value.as_ptr() as *mut u8,
        };
        let mut output = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };
        if CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            1,
            &mut output,
        ) == 0
        {
            return Err("The runtime switch receipt secret could not be opened.".to_owned());
        }
        let secret = std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec();
        let _ = LocalFree(output.pb_data as *mut std::ffi::c_void);
        Ok(secret)
    }
}

#[cfg(not(windows))]
fn protect_current_user_secret(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Runtime switch receipts require Windows data protection.".to_owned())
}

#[cfg(not(windows))]
fn protect_current_user_secret_decode(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Runtime switch receipts require Windows data protection.".to_owned())
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

fn secure_equals(actual: Option<&str>, expected: &str) -> bool {
    let Some(actual) = actual else {
        return false;
    };
    if actual.len() != expected.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in actual.bytes().zip(expected.bytes()) {
        difference |= left ^ right;
    }
    difference == 0
}

fn switch_proof(token: &str, nonce: &str, target: &str, current_app: &Path) -> String {
    hash(&format!(
        "{token}\n{nonce}\n{target}\n{}",
        current_app.display()
    ))
}

pub fn validate_shutdown_request_status(handoff: &RuntimeSwitchHandoff) -> Result<(), String> {
    with_runtime_switch_lock(&handoff.status_path, || {
        let status = read_runtime_switch_status(&handoff.status_path)?;
        let expires_at = status
            .handoff_expires_at_utc
            .as_deref()
            .and_then(parse_unix_millis)
            .ok_or_else(|| "The runtime switch shutdown request expiry is invalid.".to_owned())?;
        if system_time_millis(SystemTime::now()) > expires_at
            || status.status != "shutdown_requested"
            || !handoff_matches_record(handoff, &status)
        {
            return Err(
                "The runtime switch shutdown request expired or is unauthenticated.".to_owned(),
            );
        }
        Ok(())
    })
}

#[doc(hidden)]
pub fn switch_proof_for_test(token: &str, nonce: &str, target: &str, current_app: &Path) -> String {
    switch_proof(token, nonce, target, current_app)
}

fn resolve_and_validate_stable_manager() -> Result<PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "The stable setup manager requires LOCALAPPDATA.".to_owned())?;
    let expected_manager = resolve_stable_manager_path(&local_app_data)?;
    if !expected_manager.exists() {
        recover_missing_manager(&local_app_data, &expected_manager)?;
    }
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
    validate_manager_signature(manager, &signature)?;
    Ok(())
}

fn validate_manager_signature(manager: &Path, signature: &str) -> Result<(), String> {
    let manager_bytes =
        fs::read(manager).map_err(|_| "The setup manager executable is unavailable.".to_owned())?;
    verify_encoded_minisign(&manager_bytes, signature, MINISIGN_PUBLIC_KEY).map_err(|_| {
        "The setup manager signature is invalid. Run Setup recovery and try again.".to_owned()
    })
}

fn verify_encoded_minisign(
    payload: &[u8],
    encoded_signature: &str,
    encoded_public_key: &str,
) -> Result<(), String> {
    let key_bytes = BASE64
        .decode(encoded_public_key.trim().trim_start_matches('\u{feff}'))
        .map_err(|_| "The embedded setup manager key is malformed.".to_owned())?;
    let key_text = std::str::from_utf8(&key_bytes)
        .map_err(|_| "The embedded setup manager key is malformed.".to_owned())?;
    let signature_bytes = BASE64
        .decode(encoded_signature.trim().trim_start_matches('\u{feff}'))
        .map_err(|_| "The setup manager signature is malformed.".to_owned())?;
    let signature_text = std::str::from_utf8(&signature_bytes)
        .map_err(|_| "The setup manager signature is malformed.".to_owned())?;
    let public_key = PublicKey::decode(key_text)
        .map_err(|_| "The embedded setup manager key is malformed.".to_owned())?;
    let signature = Signature::decode(signature_text)
        .map_err(|_| "The setup manager signature is malformed.".to_owned())?;
    public_key
        .verify(payload, &signature, false)
        .map_err(|_| "The setup manager signature is invalid.".to_owned())
}

fn exact_release_asset_url(tag: &str, asset_name: &str) -> Result<String, String> {
    let version = tag
        .strip_prefix('v')
        .ok_or_else(|| "The runtime release tag is invalid.".to_owned())?;
    let has_prerelease = version.contains('-');
    let (core, suffix) = version.split_once('-').unwrap_or((version, ""));
    let components: Vec<_> = core.split('.').collect();
    if components.len() != 3
        || components
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|value| value.is_ascii_digit()))
        || (has_prerelease
            && (suffix.is_empty()
                || !suffix
                    .bytes()
                    .next()
                    .is_some_and(|value| value.is_ascii_alphanumeric())
                || !suffix
                    .bytes()
                    .all(|value| value.is_ascii_alphanumeric() || value == b'.' || value == b'-')))
        || asset_name.is_empty()
        || Path::new(asset_name)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(asset_name)
    {
        return Err("The runtime release asset identity is invalid.".to_owned());
    }
    Ok(format!("{RELEASE_DOWNLOAD_ROOT}{tag}/{asset_name}"))
}

fn recover_missing_manager(local_app_data: &Path, expected_manager: &Path) -> Result<(), String> {
    let manager_directory = expected_manager
        .parent()
        .ok_or_else(|| "The setup manager recovery path is invalid.".to_owned())?;
    fs::create_dir_all(manager_directory)
        .map_err(|_| "The setup manager recovery directory could not be created.".to_owned())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|_| "The setup manager recovery client could not start.".to_owned())?;
    let manifest_bytes = download_exact_release_asset(
        &client,
        RUNTIME_RELEASE_TAG,
        "package-manifest.json",
        4 * 1024 * 1024,
    )?;
    let manifest_signature = String::from_utf8(download_exact_release_asset(
        &client,
        RUNTIME_RELEASE_TAG,
        "package-manifest.json.sig",
        1024 * 1024,
    )?)
    .map_err(|_| "The recovered package manifest signature is malformed.".to_owned())?;
    verify_encoded_minisign(&manifest_bytes, &manifest_signature, MINISIGN_PUBLIC_KEY)
        .map_err(|_| "The recovered package manifest signature is invalid.".to_owned())?;
    let manifest: RecoveryPackageManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "The recovered package manifest is malformed.".to_owned())?;
    let expected_name = format!("VRCNT_{MANAGER_VERSION}_Setup.exe");
    if manifest.schema != MANIFEST_SCHEMA
        || manifest.product != "VRCNT"
        || manifest.version != MANAGER_VERSION
        || manifest.architecture != "x64"
        || manifest.bootstrapper.name != expected_name
        || manifest.bootstrapper.size == 0
        || !is_sha256(&manifest.bootstrapper.sha256)
        || manifest.bootstrapper.manager_protocol != MANAGER_PROTOCOL
        || manifest.bootstrapper.manifest_schema != MANIFEST_SCHEMA
        || manifest.bootstrapper.runtime_state_schema != RUNTIME_STATE_SCHEMA
        || manifest.bootstrapper.activation_protocol != ACTIVATION_PROTOCOL
    {
        return Err(
            "The recovered Setup manifest identity is incompatible with this application."
                .to_owned(),
        );
    }
    let manager_bytes = download_exact_release_asset(
        &client,
        RUNTIME_RELEASE_TAG,
        &expected_name,
        manifest.bootstrapper.size,
    )?;
    if manager_bytes.len() as u64 != manifest.bootstrapper.size
        || hash_bytes(&manager_bytes) != manifest.bootstrapper.sha256.to_ascii_lowercase()
    {
        return Err(
            "The recovered Setup manager failed its signed size or SHA-256 check.".to_owned(),
        );
    }
    let manager_signature = String::from_utf8(download_exact_release_asset(
        &client,
        RUNTIME_RELEASE_TAG,
        &format!("{expected_name}.sig"),
        1024 * 1024,
    )?)
    .map_err(|_| "The recovered Setup manager signature is malformed.".to_owned())?;
    verify_encoded_minisign(&manager_bytes, &manager_signature, MINISIGN_PUBLIC_KEY)
        .map_err(|_| "The recovered Setup manager signature is invalid.".to_owned())?;

    promote_recovered_manager(
        local_app_data,
        expected_manager,
        &manager_bytes,
        manager_signature.trim(),
    )
}

fn download_exact_release_asset(
    client: &reqwest::blocking::Client,
    tag: &str,
    asset_name: &str,
    maximum_size: u64,
) -> Result<Vec<u8>, String> {
    let url = exact_release_asset_url(tag, asset_name)?;
    let response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|_| {
            format!("The exact {tag} release asset {asset_name} could not be downloaded.")
        })?;
    if response
        .content_length()
        .is_some_and(|length| length > maximum_size)
    {
        return Err(format!(
            "The exact {tag} release asset {asset_name} is oversized."
        ));
    }
    let bytes = response
        .bytes()
        .map_err(|_| format!("The exact {tag} release asset {asset_name} could not be read."))?;
    if bytes.is_empty() || bytes.len() as u64 > maximum_size {
        return Err(format!(
            "The exact {tag} release asset {asset_name} has an invalid size."
        ));
    }
    Ok(bytes.to_vec())
}

fn promote_recovered_manager(
    _local_app_data: &Path,
    manager: &Path,
    manager_bytes: &[u8],
    signature: &str,
) -> Result<(), String> {
    let directory = manager
        .parent()
        .ok_or_else(|| "The setup manager recovery path is invalid.".to_owned())?;
    let signature_path = directory.join(MANAGER_SIGNATURE_FILE_NAME);
    let state_path = directory.join(MANAGER_STATE_FILE_NAME);
    let old_signature = fs::read(&signature_path).ok();
    let old_state = fs::read(&state_path).ok();
    let state = ManagerStateRecord {
        manager_path: manager.display().to_string(),
        manager_sha256: hash_bytes(manager_bytes),
        version: MANAGER_VERSION.to_owned(),
        manager_protocol: MANAGER_PROTOCOL,
        manifest_schema: MANIFEST_SCHEMA,
        runtime_state_schema: RUNTIME_STATE_SCHEMA,
        activation_protocol: ACTIVATION_PROTOCOL,
        last_self_check_succeeded: true,
        updated_at_utc: format_time(SystemTime::now()),
    };
    let result = (|| {
        replace_recovery_file(&signature_path, signature.as_bytes())?;
        replace_recovery_file(manager, manager_bytes)?;
        replace_recovery_file(
            &state_path,
            &serde_json::to_vec_pretty(&state)
                .map_err(|_| "The recovered manager state could not be serialized.".to_owned())?,
        )?;
        let canonical = fs::canonicalize(manager)
            .map_err(|_| "The recovered Setup manager could not be activated.".to_owned())?;
        validate_promoted_manager(&canonical, directory)
    })();
    if result.is_err() {
        let _ = fs::remove_file(manager);
        restore_recovery_file(&signature_path, old_signature.as_deref());
        restore_recovery_file(&state_path, old_state.as_deref());
    }
    result
}

fn replace_recovery_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The recovered manager path is invalid.".to_owned())?;
    let temporary = parent.join(format!(".recovery-{}.tmp", new_secret("manager")));
    fs::write(&temporary, contents)
        .map_err(|_| "The recovered manager file could not be staged.".to_owned())?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|_| "The stale manager file could not be replaced.".to_owned())?;
    }
    fs::rename(&temporary, path).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        "The recovered manager file could not be committed.".to_owned()
    })
}

fn restore_recovery_file(path: &Path, previous: Option<&[u8]>) {
    let _ = fs::remove_file(path);
    if let Some(contents) = previous {
        let _ = fs::write(path, contents);
    }
}

pub fn stage_manager_signature_for_verification(
    check_directory: &Path,
    signature: &str,
) -> Result<PathBuf, String> {
    let signature_path = check_directory.join("manager.minisig");
    let without_bom = signature.trim_start_matches('\u{feff}');
    let normalized = without_bom.trim();
    let signature_bytes = if normalized.starts_with("untrusted comment:") {
        without_bom.as_bytes().to_vec()
    } else {
        BASE64.decode(normalized).map_err(|_| {
            "The setup manager signature is malformed. Run Setup recovery and try again.".to_owned()
        })?
    };
    fs::write(&signature_path, signature_bytes)
        .map_err(|_| "The setup manager signature could not be staged.".to_owned())?;
    Ok(signature_path)
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
    let Some(timestamp) = parse_unix_millis(value) else {
        return false;
    };
    let now = system_time_millis(SystemTime::now());
    timestamp <= now + 300_000 && now.saturating_sub(timestamp) <= 90 * 86_400_000
}

fn parse_unix_millis(value: &str) -> Option<i64> {
    let Some((date, time)) = value.split_once('T') else {
        return None;
    };
    let date_parts = date
        .split('-')
        .filter_map(|part| part.parse::<i64>().ok())
        .collect::<Vec<_>>();
    let time_core = time
        .trim_end_matches('Z')
        .split('+')
        .next()?
        .split('-')
        .next()?;
    let (time_main, fractional) = time_core.split_once('.').unwrap_or((time_core, ""));
    let time_parts = time_main
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
        return None;
    }
    let days = days_from_civil(date_parts[0], date_parts[1] as u32, date_parts[2] as u32);
    let milliseconds = fractional.chars().take(3).collect::<String>();
    let milliseconds = format!("{milliseconds:0<3}").parse::<i64>().ok()?;
    Some(
        (days * 86_400 + time_parts[0] * 3_600 + time_parts[1] * 60 + time_parts[2]) * 1_000
            + milliseconds,
    )
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

#[cfg(test)]
mod retry_clear_tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn stages_encoded_manager_signature_as_minisign_bytes() {
        let temporary = tempdir().unwrap();
        let expected = b"untrusted comment: signature from test\nRWTestSignature\n";
        let encoded = BASE64.encode(expected);

        let signature_path =
            stage_manager_signature_for_verification(temporary.path(), &encoded).unwrap();

        assert_eq!(fs::read(signature_path).unwrap(), expected);
    }

    #[test]
    fn recovery_urls_are_pinned_to_the_compiled_release_tag() {
        assert_eq!(
            exact_release_asset_url("v5.15.0-rc.1", "package-manifest.json").unwrap(),
            "https://github.com/awakenginexe/VRCNT/releases/download/v5.15.0-rc.1/package-manifest.json"
        );
        assert!(exact_release_asset_url("latest", "package-manifest.json").is_err());
        assert!(exact_release_asset_url("v5.15.0-", "package-manifest.json").is_err());
        assert!(exact_release_asset_url("v5.15.0-rc.1", "../setup.exe").is_err());
    }

    #[test]
    fn native_minisign_verification_accepts_encoded_signed_fixture() {
        let public_key = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let signature = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";
        let encoded_key = BASE64.encode(public_key);
        let encoded_signature = BASE64.encode(signature);

        verify_encoded_minisign(b"test", &encoded_signature, &encoded_key).unwrap();
        assert!(verify_encoded_minisign(b"tampered", &encoded_signature, &encoded_key).is_err());
    }

    #[test]
    fn failed_recovery_promotion_removes_the_untrusted_manager() {
        let temporary = tempdir().unwrap();
        let manager = temporary.path().join(MANAGER_FILE_NAME);
        let fixture_signature = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";
        let encoded_signature = BASE64.encode(fixture_signature);

        assert!(
            promote_recovered_manager(temporary.path(), &manager, b"test", &encoded_signature,)
                .is_err()
        );
        assert!(!manager.exists());
    }

    #[test]
    fn signed_schema_two_manager_state_reaches_signature_validation() {
        let temporary = tempdir().unwrap();
        let manager = temporary.path().join(MANAGER_FILE_NAME);
        let manager_bytes = b"trusted setup manager";
        fs::write(&manager, manager_bytes).unwrap();
        let canonical_manager = fs::canonicalize(&manager).unwrap();
        let manager_state = serde_json::json!({
            "managerPath": canonical_manager.display().to_string(),
            "managerSha256": hash_bytes(manager_bytes),
            "version": MANAGER_VERSION,
            "managerProtocol": MANAGER_PROTOCOL,
            "manifestSchema": 2,
            "runtimeStateSchema": RUNTIME_STATE_SCHEMA,
            "activationProtocol": ACTIVATION_PROTOCOL,
            "lastSelfCheckSucceeded": true,
            "updatedAtUtc": format_time(SystemTime::now()),
        });
        fs::write(
            temporary.path().join(MANAGER_STATE_FILE_NAME),
            serde_json::to_vec(&manager_state).unwrap(),
        )
        .unwrap();

        let error = validate_promoted_manager(&canonical_manager, temporary.path()).unwrap_err();

        assert_eq!(
            error,
            "The setup manager signature is missing. Run Setup recovery and try again."
        );
    }

    fn handoff(root: &Path, nonce: &str, token: &str, generation: u64) -> RuntimeSwitchHandoff {
        let app = root.join("VRCNT.exe");
        fs::write(&app, b"runtime remains alive").unwrap();
        let install_path = fs::canonicalize(root).unwrap();
        let current_app_path = fs::canonicalize(&app).unwrap();
        RuntimeSwitchHandoff {
            nonce: nonce.to_owned(),
            token: token.to_owned(),
            target_variant: "cuda".to_owned(),
            proof: switch_proof(token, nonce, "cuda", &current_app_path),
            status_path: install_path.join(RUNTIME_SWITCH_STATUS_FILE_NAME),
            current_app_path,
            install_path,
            lease_generation: generation,
        }
    }

    fn write_retry_clear(handoff: &RuntimeSwitchHandoff) {
        let token_sha256 = hash(&handoff.token);
        let record = RuntimeSwitchRetryClearRecordForWrite {
            schema: 1,
            nonce: &handoff.nonce,
            target_variant: &handoff.target_variant,
            token_sha256: &token_sha256,
            proof_sha256: &handoff.proof,
            current_app_path: &handoff.current_app_path,
            install_path: &handoff.install_path,
            lease_generation: handoff.lease_generation,
        };
        write_runtime_switch_retry_clear_unlocked(handoff, &record).unwrap();
    }

    fn status(handoff: &RuntimeSwitchHandoff, value: &str) -> RuntimeSwitchStatusRecord {
        RuntimeSwitchStatusRecord {
            schema: 1,
            status: value.to_owned(),
            target_variant: handoff.target_variant.clone(),
            nonce: handoff.nonce.clone(),
            token_sha256: hash(&handoff.token),
            proof_sha256: handoff.proof.clone(),
            current_app_path: handoff.current_app_path.display().to_string(),
            install_path: handoff.install_path.display().to_string(),
            error_code: None,
            message: None,
            updated_at_utc: format_time(SystemTime::now()),
            manager_process_id: None,
            handoff_expires_at_utc: None,
            receipt_mac: None,
            receipt_expires_at_unix_ms: None,
            consumed_at_utc: None,
            lease_generation: handoff.lease_generation,
        }
    }

    fn write_status(handoff: &RuntimeSwitchHandoff, value: &str) {
        write_runtime_switch_status_record(&handoff.status_path, &status(handoff, value)).unwrap();
    }

    #[test]
    fn failed_pre_quiesce_retry_clear_releases_the_matching_live_handoff() {
        let temporary = tempdir().unwrap();
        let initial = handoff(temporary.path(), "failed-nonce", "failed-token", 7);
        let state = RuntimeSwitchState::new();
        state.begin(initial.clone()).unwrap();
        write_retry_clear(&initial);

        assert!(state.recover_abandoned_pre_quiesce_handoff().unwrap());
        let next = begin_runtime_switch(
            temporary.path(),
            "cuda",
            temporary.path(),
            &initial.current_app_path,
        )
        .unwrap();
        assert_eq!(next.lease_generation, 8);
        assert!(state.begin(next).is_ok());
    }

    #[test]
    fn cancelled_pre_quiesce_retry_clear_releases_the_matching_live_handoff() {
        let temporary = tempdir().unwrap();
        let initial = handoff(temporary.path(), "cancel-nonce", "cancel-token", 11);
        let state = RuntimeSwitchState::new();
        state.begin(initial.clone()).unwrap();
        write_retry_clear(&initial);

        assert!(state.recover_abandoned_pre_quiesce_handoff().unwrap());
        let next = begin_runtime_switch(
            temporary.path(),
            "cuda",
            temporary.path(),
            &initial.current_app_path,
        )
        .unwrap();
        assert_eq!(next.lease_generation, 12);
        assert!(state.begin(next).is_ok());
    }

    #[test]
    fn retry_clear_cannot_release_a_newer_live_handoff_or_replace_its_status() {
        let temporary = tempdir().unwrap();
        let old = handoff(temporary.path(), "old-nonce", "old-token", 3);
        let newer = handoff(temporary.path(), "new-nonce", "new-token", 4);
        let state = RuntimeSwitchState::new();
        state.begin(newer.clone()).unwrap();
        write_retry_clear(&old);
        let mut active = status(&newer, "pending");
        active.handoff_expires_at_utc = Some(format_time(
            SystemTime::now() + Duration::from_secs(15 * 60),
        ));
        write_runtime_switch_status_record(&newer.status_path, &active).unwrap();

        assert!(!state.recover_abandoned_pre_quiesce_handoff().unwrap());
        assert!(state
            .begin(handoff(temporary.path(), "later-nonce", "later-token", 5))
            .is_err());
    }

    #[test]
    fn terminal_cleanup_uses_canonical_path_identity() {
        let temporary = tempdir().unwrap();
        let active = handoff(temporary.path(), "canonical-nonce", "canonical-token", 6);
        let state = RuntimeSwitchState::new();
        state.begin(active.clone()).unwrap();
        let mut terminal = status(&active, "failed");
        let alias_segment = active.install_path.join("path-alias");
        fs::create_dir(&alias_segment).unwrap();
        terminal.current_app_path = active
            .install_path
            .join("path-alias")
            .join("..")
            .join("VRCNT.exe")
            .display()
            .to_string();
        terminal.install_path = active
            .install_path
            .join("path-alias")
            .join("..")
            .display()
            .to_string();

        assert!(state.clear_if_owns_status(&terminal).unwrap());
        assert!(state
            .begin(handoff(temporary.path(), "next", "next-token", 7))
            .is_ok());
    }

    #[test]
    fn terminal_cleanup_rejects_each_incomplete_handoff_identity() {
        let temporary = tempdir().unwrap();
        let active = handoff(temporary.path(), "owned-nonce", "owned-token", 9);
        let other_root = tempdir().unwrap();
        let other_app = other_root.path().join("VRCNT.exe");
        fs::write(&other_app, b"different runtime").unwrap();
        let different_app = fs::canonicalize(&other_app).unwrap().display().to_string();
        let different_install = fs::canonicalize(other_root.path())
            .unwrap()
            .display()
            .to_string();

        let mut cases: Vec<(&str, RuntimeSwitchStatusRecord)> = Vec::new();
        let mut wrong_nonce = status(&active, "failed");
        wrong_nonce.nonce = "different-nonce".to_owned();
        cases.push(("nonce", wrong_nonce));
        let mut wrong_generation = status(&active, "failed");
        wrong_generation.lease_generation += 1;
        cases.push(("generation", wrong_generation));
        let mut wrong_token = status(&active, "failed");
        wrong_token.token_sha256 = hash("different-token");
        cases.push(("token", wrong_token));
        let mut wrong_proof = status(&active, "failed");
        wrong_proof.proof_sha256 = hash("different-proof");
        cases.push(("proof", wrong_proof));
        let mut wrong_app = status(&active, "failed");
        wrong_app.current_app_path = different_app;
        cases.push(("application path", wrong_app));
        let mut wrong_install = status(&active, "failed");
        wrong_install.install_path = different_install;
        cases.push(("install path", wrong_install));

        for (label, unowned) in cases {
            let state = RuntimeSwitchState::new();
            state.begin(active.clone()).unwrap();
            assert!(!state.clear_if_owns_status(&unowned).unwrap(), "{label}");
            let shutdown = status(&active, "shutdown_requested");
            assert_eq!(
                state
                    .deliver_shutdown_request(&shutdown)
                    .unwrap()
                    .unwrap()
                    .nonce,
                active.nonce,
                "{label}"
            );
        }
    }

    #[test]
    fn stale_recovery_cannot_clear_a_newer_handoff_after_its_lease_is_marked_stale() {
        let temporary = tempdir().unwrap();
        let old = handoff(temporary.path(), "old-nonce", "old-token", 3);
        let newer = handoff(temporary.path(), "new-nonce", "new-token", 4);
        let mut old_status = status(&old, "running");
        old_status.manager_process_id = Some(424242);
        old_status.handoff_expires_at_utc = Some("2020-01-01T00:01:00.000Z".to_owned());
        write_runtime_switch_status_record(&old.status_path, &old_status).unwrap();
        let state = Arc::new(RuntimeSwitchState::new());
        state.begin(old.clone()).unwrap();
        let after_stale_commit = Arc::new(Barrier::new(2));
        let resume_recovery = Arc::new(Barrier::new(2));
        let recovery_state = Arc::clone(&state);
        let recovery_after_stale_commit = Arc::clone(&after_stale_commit);
        let recovery_resume = Arc::clone(&resume_recovery);

        let recovery = thread::spawn(move || {
            recovery_state.recover_abandoned_pre_quiesce_handoff_with_after_recovery(|| {
                recovery_after_stale_commit.wait();
                recovery_resume.wait();
            })
        });

        after_stale_commit.wait();
        let stale = read_runtime_switch_status(&old.status_path).unwrap();
        assert_eq!(stale.status, "stale");
        assert!(state.clear_if_owns_status(&stale).unwrap());
        state.begin(newer.clone()).unwrap();
        write_status(&newer, "shutdown_requested");
        resume_recovery.wait();

        assert!(recovery.join().unwrap().unwrap());
        let shutdown = read_runtime_switch_status(&newer.status_path).unwrap();
        assert_eq!(
            state
                .deliver_shutdown_request(&shutdown)
                .unwrap()
                .unwrap()
                .nonce,
            newer.nonce
        );
    }

    #[test]
    fn terminal_cleanup_cannot_clear_a_newer_handoff_after_observing_an_old_receipt() {
        let temporary = tempdir().unwrap();
        let old = handoff(temporary.path(), "terminal-old", "old-token", 7);
        let newer = handoff(temporary.path(), "terminal-new", "new-token", 8);
        let state = Arc::new(RuntimeSwitchState::new());
        state.begin(old.clone()).unwrap();
        let terminal = status(&old, "failed");
        write_runtime_switch_status_record(&old.status_path, &terminal).unwrap();
        let observed_terminal = terminal.clone();
        let observed = Arc::new(Barrier::new(2));
        let resume_cleanup = Arc::new(Barrier::new(2));
        let cleanup_state = Arc::clone(&state);
        let cleanup_observed = Arc::clone(&observed);
        let cleanup_resume = Arc::clone(&resume_cleanup);

        let cleanup = thread::spawn(move || {
            cleanup_observed.wait();
            cleanup_resume.wait();
            cleanup_state.clear_if_owns_status(&observed_terminal)
        });

        observed.wait();
        assert!(state.clear_if_owns_status(&terminal).unwrap());
        state.begin(newer.clone()).unwrap();
        write_status(&newer, "shutdown_requested");
        resume_cleanup.wait();

        assert!(!cleanup.join().unwrap().unwrap());
        let shutdown = read_runtime_switch_status(&newer.status_path).unwrap();
        assert_eq!(
            state
                .deliver_shutdown_request(&shutdown)
                .unwrap()
                .unwrap()
                .nonce,
            newer.nonce
        );
    }
}
