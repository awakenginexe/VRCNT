use font_kit::loaders::default::Font;
use fs2::FileExt;
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::Emitter;

const SCHEMA_VERSION: u32 = 1;
const SOURCE_REVISION: &str = "2796410152d4f9524b68ed46e69c1b60f8e0f7c3";
const DOWNLOAD_RETRY_ATTEMPTS: u8 = 3;
const DOWNLOAD_EVENT: &str = "font-pack-download-progress";
const ALLOWED_PACK_IDS: &[&str] = &[
    "latin-greek-cyrillic",
    "thai",
    "japanese",
    "cjk-simplified",
    "cjk-traditional",
    "korean",
    "lao",
    "khmer",
    "myanmar",
    "devanagari",
    "arabic",
    "cjk-hong-kong",
    "urdu",
    "ethiopic",
    "armenian",
    "bengali",
    "georgian",
    "gujarati",
    "hebrew",
    "kannada",
    "malayalam",
    "sinhala",
    "tamil",
    "telugu",
    "emoji",
];

static CACHE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FontDownloadPolicy {
    Ask,
    Automatic,
    Never,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FontDownloadAction {
    Available,
    Ask,
    Download,
    Fallback,
}

pub fn decide_font_download(
    policy: FontDownloadPolicy,
    already_available: bool,
) -> FontDownloadPolicy {
    if already_available {
        FontDownloadPolicy::Never
    } else {
        policy
    }
}

pub fn font_download_action(
    policy: FontDownloadPolicy,
    already_available: bool,
    confirmed: bool,
) -> FontDownloadAction {
    if already_available {
        FontDownloadAction::Available
    } else {
        match policy {
            FontDownloadPolicy::Ask if !confirmed => FontDownloadAction::Ask,
            FontDownloadPolicy::Never => FontDownloadAction::Fallback,
            FontDownloadPolicy::Ask | FontDownloadPolicy::Automatic => FontDownloadAction::Download,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontManifest {
    pub schema_version: u32,
    pub manifest_version: String,
    pub font_family_version: String,
    pub source_revision: String,
    pub packs: BTreeMap<String, FontPack>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPack {
    pub bundled: bool,
    pub display_name: String,
    pub scripts: Vec<String>,
    pub family: String,
    pub source_family: String,
    pub pack_version: String,
    pub license_spdx: String,
    pub copyright_notice: String,
    pub files: Vec<FontPackFile>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPackFile {
    pub role: String,
    pub relative_path: String,
    pub format: String,
    #[serde(default)]
    pub weight_range: Option<[u16; 2]>,
    pub source_revision: String,
    pub source_url: String,
    pub expected_bytes: u64,
    pub sha256: String,
    pub license_spdx: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
    pub pack_id: String,
    pub pack_version: String,
    pub manifest_version: String,
    pub files: Vec<InstalledFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFile {
    pub relative_path: String,
    pub expected_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontPackDownloadProgress {
    pub pack_id: String,
    pub state: String,
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub attempt: u8,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontPackDownloadResult {
    pub pack_id: String,
    pub installed: bool,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPackDownloadRequest {
    pub pack_id: String,
    pub policy: FontDownloadPolicy,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPackDownloadOutcome {
    pub action: FontDownloadAction,
    pub result: Option<FontPackDownloadResult>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFontAsset {
    pub pack_id: String,
    pub family: String,
    pub path: String,
    pub weight_range: Option<[u16; 2]>,
}

impl FontManifest {
    pub fn parse(json: &str) -> Result<Self, String> {
        let manifest: Self = serde_json::from_str(json)
            .map_err(|error| format!("Invalid font manifest JSON: {error}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let json = fs::read_to_string(path)
            .map_err(|error| format!("Unable to read font manifest: {error}"))?;
        Self::parse(&json)
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err("Unsupported font manifest schema version".into());
        }
        if self.manifest_version.trim().is_empty()
            || self.font_family_version.trim().is_empty()
            || self.source_revision != SOURCE_REVISION
        {
            return Err("Invalid font manifest identity".into());
        }
        if self.packs.is_empty() {
            return Err("Font manifest has no packs".into());
        }

        let mut paths = HashSet::new();
        for (id, pack) in &self.packs {
            if !ALLOWED_PACK_IDS.contains(&id.as_str())
                || pack.display_name.trim().is_empty()
                || pack.scripts.is_empty()
                || pack.family.trim().is_empty()
                || pack.source_family.trim().is_empty()
                || pack.pack_version.trim().is_empty()
                || pack.license_spdx != "OFL-1.1"
                || pack.copyright_notice.trim().is_empty()
            {
                return Err(format!("Invalid font pack: {id}"));
            }
            if pack.files.is_empty()
                || !pack
                    .files
                    .iter()
                    .any(|file| file.role == "license" && file.relative_path == "OFL.txt")
                || !pack.files.iter().any(|file| is_font_file(file))
            {
                return Err(format!("Font pack missing required files: {id}"));
            }
            for file in &pack.files {
                if !is_safe_file_name(&file.relative_path)
                    || !paths.insert((id.clone(), file.relative_path.clone()))
                    || file.expected_bytes == 0
                    || !is_sha256(&file.sha256)
                    || file.license_spdx != "OFL-1.1"
                    || file.source_revision != SOURCE_REVISION
                    || !is_trusted_url(&file.source_url, pack.bundled)
                {
                    return Err(format!("Invalid font file for {id}"));
                }
                match file.role.as_str() {
                    "web-and-pillow" | "font"
                        if file.format == "ttf"
                            && file.relative_path.ends_with(".ttf")
                            && file.weight_range.is_some() => {}
                    "license" if file.format == "text" && file.relative_path == "OFL.txt" => {}
                    _ => return Err(format!("Unsupported font file role for {id}")),
                }
            }
        }
        Ok(())
    }

    pub fn pack(&self, pack_id: &str) -> Result<&FontPack, String> {
        self.packs
            .get(pack_id)
            .ok_or_else(|| "Unknown font pack".into())
    }
}

#[derive(Clone)]
pub struct FontCache {
    root: PathBuf,
    manifest: FontManifest,
}

impl FontCache {
    pub fn open_at(root: PathBuf, manifest: FontManifest) -> Result<Self, String> {
        fs::create_dir_all(root.join(".staging")).map_err(io_error)?;
        fs::create_dir_all(root.join("packs")).map_err(io_error)?;
        Ok(Self { root, manifest })
    }

    pub fn staging_root(&self) -> PathBuf {
        self.root.join(".staging")
    }

    pub fn default_root() -> PathBuf {
        let base = std::env::var_os("LOCALAPPDATA")
            .or_else(|| std::env::var_os("APPDATA"))
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."))
            });
        let current = base.join("VRCNTData");
        let legacy = base.join("VRCNT-NextData");
        if current.exists() || !legacy.exists() {
            current.join("fonts")
        } else {
            legacy.join("fonts")
        }
    }

    pub fn recover(&self) -> Result<(), String> {
        let _guard = cache_lock()?;
        if self.staging_root().is_dir() {
            for item in fs::read_dir(self.staging_root()).map_err(io_error)? {
                let item = item.map_err(io_error)?;
                if item.path().is_dir() {
                    fs::remove_dir_all(item.path()).map_err(io_error)?;
                } else {
                    fs::remove_file(item.path()).map_err(io_error)?;
                }
            }
        }
        Ok(())
    }

    pub fn install_from_directory(&self, pack_id: &str, source: &Path) -> Result<(), String> {
        let pack = self.optional_pack(pack_id)?.clone();
        verify_files(&pack, source)?;
        verify_font_metadata(&pack, source)?;

        let staging = self.new_staging_directory(pack_id)?;
        let copy_result = (|| {
            for file in &pack.files {
                fs::copy(
                    source.join(&file.relative_path),
                    staging.join(&file.relative_path),
                )
                .map_err(io_error)?;
            }
            verify_files(&pack, &staging)?;
            verify_font_metadata(&pack, &staging)?;
            self.activate_staging(pack_id, &pack, &staging)
        })();
        if copy_result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        copy_result
    }

    pub fn download_optional_with<F, P>(
        &self,
        pack_id: &str,
        retry_attempts: u8,
        cancellation: &FontDownloadCancellation,
        mut fetch: F,
        mut on_progress: P,
    ) -> Result<FontPackDownloadResult, String>
    where
        F: FnMut(
            &FontPackFile,
            &Path,
            &FontDownloadCancellation,
            &mut dyn FnMut(u64),
        ) -> Result<(), String>,
        P: FnMut(FontPackDownloadProgress),
    {
        let pack = self.optional_pack(pack_id)?.clone();
        let total_bytes = pack.files.iter().map(|file| file.expected_bytes).sum();
        if self.installed_pack(pack_id)?.is_some() {
            return Ok(FontPackDownloadResult {
                pack_id: pack_id.into(),
                installed: true,
                total_bytes,
            });
        }

        let attempts = retry_attempts.max(1);
        let mut last_error = "Font pack download failed".to_string();
        for attempt in 1..=attempts {
            let staging = self.new_staging_directory(pack_id)?;
            let mut received_bytes: u64 = 0;
            let result = (|| {
                for file in &pack.files {
                    cancellation.check()?;
                    let mut report = |delta: u64| {
                        received_bytes = received_bytes.saturating_add(delta);
                        on_progress(FontPackDownloadProgress {
                            pack_id: pack_id.into(),
                            state: "downloading".into(),
                            received_bytes,
                            total_bytes,
                            attempt,
                            error: None,
                        });
                    };
                    fetch(
                        file,
                        &staging.join(&file.relative_path),
                        cancellation,
                        &mut report,
                    )?;
                }
                cancellation.check()?;
                verify_files(&pack, &staging)?;
                verify_font_metadata(&pack, &staging)?;
                self.activate_staging(pack_id, &pack, &staging)
            })();

            match result {
                Ok(()) => {
                    on_progress(FontPackDownloadProgress {
                        pack_id: pack_id.into(),
                        state: "complete".into(),
                        received_bytes: total_bytes,
                        total_bytes,
                        attempt,
                        error: None,
                    });
                    return Ok(FontPackDownloadResult {
                        pack_id: pack_id.into(),
                        installed: true,
                        total_bytes,
                    });
                }
                Err(error) => {
                    let _ = fs::remove_dir_all(&staging);
                    last_error = error;
                    if cancellation.is_cancelled() {
                        on_progress(FontPackDownloadProgress {
                            pack_id: pack_id.into(),
                            state: "cancelled".into(),
                            received_bytes,
                            total_bytes,
                            attempt,
                            error: Some(last_error.clone()),
                        });
                        return Err(last_error);
                    }
                    if attempt < attempts {
                        on_progress(FontPackDownloadProgress {
                            pack_id: pack_id.into(),
                            state: "retrying".into(),
                            received_bytes,
                            total_bytes,
                            attempt,
                            error: Some(last_error.clone()),
                        });
                    }
                }
            }
        }

        on_progress(FontPackDownloadProgress {
            pack_id: pack_id.into(),
            state: "failed".into(),
            received_bytes: 0,
            total_bytes,
            attempt: attempts,
            error: Some(last_error.clone()),
        });
        Err(last_error)
    }

    pub fn installed_pack(&self, pack_id: &str) -> Result<Option<InstalledPack>, String> {
        let pack = self.manifest.pack(pack_id)?;
        let directory = self
            .root
            .join("packs")
            .join(pack_id)
            .join(&pack.pack_version);
        if !directory.is_dir() {
            return Ok(None);
        }
        if let Some(installed) = self.verified_installed_pack(pack_id, pack, &directory) {
            return Ok(Some(installed));
        }
        {
            let _guard = cache_lock()?;
            let _ = fs::remove_dir_all(&directory);
        }
        Ok(None)
    }

    pub fn total_verified_bytes(&self) -> Result<u64, String> {
        let mut total = 0;
        for id in self.manifest.packs.keys() {
            if let Some(installed) = self.installed_pack(id)? {
                total += installed
                    .files
                    .iter()
                    .map(|file| file.expected_bytes)
                    .sum::<u64>();
            }
        }
        Ok(total)
    }

    pub fn remove_optional_pack(&self, pack_id: &str) -> Result<(), String> {
        if self.manifest.pack(pack_id)?.bundled {
            return Err("Bundled font packs cannot be removed".into());
        }
        let directory = self.root.join("packs").join(pack_id);
        if directory.exists() {
            let _guard = cache_lock()?;
            fs::remove_dir_all(directory).map_err(io_error)?;
        }
        Ok(())
    }

    pub fn managed_font_assets(
        &self,
        bundled_root: &Path,
        pack_ids: &[String],
    ) -> Result<Vec<ManagedFontAsset>, String> {
        let mut assets = Vec::new();
        let mut seen = HashSet::new();
        for pack_id in pack_ids {
            if !seen.insert(pack_id) {
                continue;
            }
            let pack = self.manifest.pack(pack_id)?;
            let directory = if pack.bundled {
                bundled_root.join(pack_id)
            } else {
                let Some(installed) = self.installed_pack(pack_id)? else {
                    continue;
                };
                self.root
                    .join("packs")
                    .join(&installed.pack_id)
                    .join(&installed.pack_version)
            };
            verify_files(pack, &directory)?;
            verify_font_metadata(pack, &directory)?;
            for file in pack.files.iter().filter(|file| is_font_file(file)) {
                assets.push(ManagedFontAsset {
                    pack_id: pack_id.clone(),
                    family: "VRCNT Noto".into(),
                    path: directory
                        .join(&file.relative_path)
                        .to_string_lossy()
                        .into_owned(),
                    weight_range: file.weight_range,
                });
            }
        }
        Ok(assets)
    }

    fn optional_pack(&self, pack_id: &str) -> Result<&FontPack, String> {
        let pack = self.manifest.pack(pack_id)?;
        if pack.bundled {
            Err("Bundled font packs are not cache-installable".into())
        } else {
            Ok(pack)
        }
    }

    fn new_staging_directory(&self, pack_id: &str) -> Result<PathBuf, String> {
        let staging = self
            .staging_root()
            .join(format!("{pack_id}-{}", unique_id()));
        fs::create_dir_all(&staging).map_err(io_error)?;
        Ok(staging)
    }

    fn activate_staging(
        &self,
        pack_id: &str,
        pack: &FontPack,
        staging: &Path,
    ) -> Result<(), String> {
        let marker = InstalledPack {
            pack_id: pack_id.into(),
            pack_version: pack.pack_version.clone(),
            manifest_version: self.manifest.manifest_version.clone(),
            files: pack
                .files
                .iter()
                .map(|file| InstalledFile {
                    relative_path: file.relative_path.clone(),
                    expected_bytes: file.expected_bytes,
                    sha256: file.sha256.clone(),
                })
                .collect(),
        };
        fs::write(
            staging.join("installed.v1.json"),
            serde_json::to_vec(&marker).map_err(|error| error.to_string())?,
        )
        .map_err(io_error)?;

        let final_dir = self
            .root
            .join("packs")
            .join(pack_id)
            .join(&pack.pack_version);
        let parent = final_dir.parent().ok_or("Invalid cache path")?;
        fs::create_dir_all(parent).map_err(io_error)?;
        let _guard = cache_lock()?;
        if final_dir.exists() {
            if self
                .verified_installed_pack(pack_id, pack, &final_dir)
                .is_some()
            {
                fs::remove_dir_all(staging).map_err(io_error)?;
                return Ok(());
            }
            fs::remove_dir_all(&final_dir).map_err(io_error)?;
        }
        fs::rename(staging, &final_dir).map_err(io_error)
    }

    fn verified_installed_pack(
        &self,
        pack_id: &str,
        pack: &FontPack,
        directory: &Path,
    ) -> Option<InstalledPack> {
        let marker = directory.join("installed.v1.json");
        let installed: InstalledPack = serde_json::from_slice(&fs::read(marker).ok()?).ok()?;
        let listed_files_match = installed.files.len() == pack.files.len()
            && pack.files.iter().all(|file| {
                installed.files.iter().any(|installed_file| {
                    installed_file.relative_path == file.relative_path
                        && installed_file.expected_bytes == file.expected_bytes
                        && installed_file.sha256 == file.sha256
                })
            });
        if installed.pack_id == pack_id
            && installed.pack_version == pack.pack_version
            && installed.manifest_version == self.manifest.manifest_version
            && listed_files_match
            && verify_files(pack, directory).is_ok()
            && verify_font_metadata(pack, directory).is_ok()
        {
            Some(installed)
        } else {
            None
        }
    }
}

#[derive(Clone, Default)]
pub struct FontDownloadCancellation(Arc<AtomicBool>);

impl FontDownloadCancellation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("Font pack download cancelled".into())
        } else {
            Ok(())
        }
    }
}

struct DownloadFlight {
    cancellation: FontDownloadCancellation,
    result: Mutex<Option<Result<FontPackDownloadResult, String>>>,
    completed: Condvar,
}

impl DownloadFlight {
    fn new() -> Self {
        Self {
            cancellation: FontDownloadCancellation::new(),
            result: Mutex::new(None),
            completed: Condvar::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct FontPackDownloadManager {
    flights: Arc<Mutex<HashMap<String, Arc<DownloadFlight>>>>,
}

impl FontPackDownloadManager {
    pub fn cancel(&self, pack_id: &str) -> bool {
        let Ok(flights) = self.flights.lock() else {
            return false;
        };
        let Some(flight) = flights.get(pack_id) else {
            return false;
        };
        flight.cancellation.cancel();
        true
    }

    pub fn download_optional_with<F, P>(
        &self,
        cache: Arc<FontCache>,
        pack_id: &str,
        retry_attempts: u8,
        fetch: F,
        on_progress: P,
    ) -> Result<FontPackDownloadResult, String>
    where
        F: FnMut(
            &FontPackFile,
            &Path,
            &FontDownloadCancellation,
            &mut dyn FnMut(u64),
        ) -> Result<(), String>,
        P: FnMut(FontPackDownloadProgress),
    {
        let (flight, owner) = {
            let mut flights = self
                .flights
                .lock()
                .map_err(|_| "Font download lock poisoned")?;
            if let Some(existing) = flights.get(pack_id) {
                (existing.clone(), false)
            } else {
                let flight = Arc::new(DownloadFlight::new());
                flights.insert(pack_id.into(), flight.clone());
                (flight, true)
            }
        };

        if !owner {
            let mut result = flight
                .result
                .lock()
                .map_err(|_| "Font download lock poisoned")?;
            while result.is_none() {
                result = flight
                    .completed
                    .wait(result)
                    .map_err(|_| "Font download lock poisoned")?;
            }
            return result
                .clone()
                .expect("download flight always stores a result");
        }

        let result = cache.download_optional_with(
            pack_id,
            retry_attempts,
            &flight.cancellation,
            fetch,
            on_progress,
        );
        {
            let mut stored = flight
                .result
                .lock()
                .map_err(|_| "Font download lock poisoned")?;
            *stored = Some(result.clone());
            flight.completed.notify_all();
        }
        let mut flights = self
            .flights
            .lock()
            .map_err(|_| "Font download lock poisoned")?;
        flights.remove(pack_id);
        result
    }
}

#[derive(Clone)]
pub struct FontPackDownloadService {
    cache: Arc<FontCache>,
    bundled_root: PathBuf,
    manager: FontPackDownloadManager,
    client: Client,
    _cache_lock: Arc<fs::File>,
}

impl FontPackDownloadService {
    pub fn open(cache_root: PathBuf, manifest_path: &Path) -> Result<Self, String> {
        let bundled_root = manifest_path
            .parent()
            .ok_or("Font manifest has no parent directory")?;
        Self::open_with_bundled_root(cache_root, manifest_path, bundled_root)
    }

    pub fn open_with_bundled_root(
        cache_root: PathBuf,
        manifest_path: &Path,
        bundled_root: &Path,
    ) -> Result<Self, String> {
        fs::create_dir_all(&cache_root).map_err(io_error)?;
        let cache_lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(cache_root.join(".manager.lock"))
            .map_err(io_error)?;
        cache_lock
            .try_lock_exclusive()
            .map_err(|_| "Font cache is already in use by another VRCNT process".to_string())?;
        let cache = Arc::new(FontCache::open_at(
            cache_root,
            FontManifest::load(manifest_path)?,
        )?);
        cache.recover()?;
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|error| format!("Unable to create font download client: {error}"))?;
        Ok(Self {
            cache,
            bundled_root: bundled_root.to_path_buf(),
            manager: FontPackDownloadManager::default(),
            client,
            _cache_lock: Arc::new(cache_lock),
        })
    }

    fn managed_font_assets(&self, pack_ids: &[String]) -> Result<Vec<ManagedFontAsset>, String> {
        self.cache.managed_font_assets(&self.bundled_root, pack_ids)
    }

    fn request_download(
        &self,
        app: &tauri::AppHandle,
        request: FontPackDownloadRequest,
    ) -> Result<FontPackDownloadOutcome, String> {
        let already_available = self.cache.installed_pack(&request.pack_id)?.is_some();
        let action = font_download_action(request.policy, already_available, request.confirmed);
        if action != FontDownloadAction::Download {
            return Ok(FontPackDownloadOutcome {
                action,
                result: None,
            });
        }

        let client = self.client.clone();
        let handle = app.clone();
        let result = self.manager.download_optional_with(
            self.cache.clone(),
            &request.pack_id,
            DOWNLOAD_RETRY_ATTEMPTS,
            move |file, destination, cancellation, report| {
                download_manifest_file(&client, file, destination, cancellation, report)
            },
            move |progress| {
                let _ = handle.emit(DOWNLOAD_EVENT, progress);
            },
        )?;
        Ok(FontPackDownloadOutcome {
            action,
            result: Some(result),
        })
    }
}

#[tauri::command]
pub async fn download_optional_font_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, FontPackDownloadService>,
    request: FontPackDownloadRequest,
) -> Result<FontPackDownloadOutcome, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.request_download(&app, request))
        .await
        .map_err(|error| format!("Font download task failed: {error}"))?
}

#[tauri::command]
pub fn cancel_optional_font_pack(
    state: tauri::State<'_, FontPackDownloadService>,
    pack_id: String,
) -> bool {
    state.manager.cancel(&pack_id)
}

#[tauri::command]
pub fn resolve_managed_font_assets(
    state: tauri::State<'_, FontPackDownloadService>,
    pack_ids: Vec<String>,
) -> Result<Vec<ManagedFontAsset>, String> {
    state.managed_font_assets(&pack_ids)
}

fn download_manifest_file(
    client: &Client,
    file: &FontPackFile,
    destination: &Path,
    cancellation: &FontDownloadCancellation,
    report: &mut dyn FnMut(u64),
) -> Result<(), String> {
    if !is_trusted_url(&file.source_url, false) {
        return Err("Font download URL is not owned by the approved manifest".into());
    }
    cancellation.check()?;
    let mut response = client
        .get(&file.source_url)
        .header("Accept", "application/octet-stream")
        .send()
        .map_err(|error| format!("Font download request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Font download HTTP error: {}", response.status()));
    }
    if response.url().as_str() != file.source_url {
        return Err("Font download redirect is not allowed".into());
    }
    if let Some(content_length) = response.content_length() {
        if content_length != file.expected_bytes {
            return Err("Font download Content-Length does not match manifest".into());
        }
    }

    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut written = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        cancellation.check()?;
        let count = response.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        written = written
            .checked_add(count as u64)
            .ok_or("Font download size overflow")?;
        if written > file.expected_bytes {
            return Err("Font download exceeds manifest size".into());
        }
        output.write_all(&buffer[..count]).map_err(io_error)?;
        hasher.update(&buffer[..count]);
        report(count as u64);
    }
    output.flush().map_err(io_error)?;
    if written != file.expected_bytes || format!("{:x}", hasher.finalize()) != file.sha256 {
        return Err("Font download integrity verification failed".into());
    }
    Ok(())
}

fn verify_files(pack: &FontPack, directory: &Path) -> Result<(), String> {
    for file in &pack.files {
        let path = directory.join(&file.relative_path);
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Font pack file is not a regular file".into());
        }
        let contents = fs::read(&path).map_err(io_error)?;
        if contents.len() as u64 != file.expected_bytes || sha256(&contents) != file.sha256 {
            return Err("Font pack integrity verification failed".into());
        }
    }
    Ok(())
}

fn verify_font_metadata(pack: &FontPack, directory: &Path) -> Result<(), String> {
    for file in pack.files.iter().filter(|file| is_font_file(file)) {
        let font_bytes = Arc::new(fs::read(directory.join(&file.relative_path)).map_err(io_error)?);
        let font = Font::from_bytes(font_bytes, 0)
            .map_err(|error| format!("Font metadata validation failed: {error}"))?;
        if font.family_name() != pack.source_family {
            return Err("Font family metadata does not match the manifest".into());
        }
        for script in &pack.scripts {
            let glyph = representative_glyph(script).ok_or_else(|| {
                format!("No representative glyph is approved for script {script}")
            })?;
            if font.glyph_for_char(glyph).is_none() {
                return Err(format!("Font is missing the representative {script} glyph"));
            }
        }
    }
    Ok(())
}

fn representative_glyph(script: &str) -> Option<char> {
    match script {
        "Latn" => Some('A'),
        "Grek" => Some('Ω'),
        "Cyrl" => Some('Ж'),
        "Thai" => Some('ก'),
        "Jpan" | "Hans" | "Hant" | "Kore" => Some('日'),
        "Laoo" => Some('ກ'),
        "Khmr" => Some('ក'),
        "Mymr" => Some('က'),
        "Deva" => Some('अ'),
        "Arab" => Some('ا'),
        "Ethi" => Some('ሀ'),
        "Armn" => Some('Ա'),
        "Beng" => Some('অ'),
        "Geor" => Some('ა'),
        "Gujr" => Some('અ'),
        "Hebr" => Some('א'),
        "Knda" => Some('ಅ'),
        "Mlym" => Some('അ'),
        "Sinh" => Some('අ'),
        "Taml" => Some('அ'),
        "Telu" => Some('అ'),
        "Zsye" => Some('😀'),
        _ => None,
    }
}

fn cache_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CACHE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Font cache lock poisoned".into())
}

fn is_font_file(file: &FontPackFile) -> bool {
    matches!(file.role.as_str(), "web-and-pillow" | "font")
        && file.format == "ttf"
        && file.relative_path.ends_with(".ttf")
}

fn sha256(contents: &[u8]) -> String {
    format!("{:x}", Sha256::digest(contents))
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}

fn unique_id() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

fn is_safe_file_name(value: &str) -> bool {
    let path = Path::new(value);
    path.components().count() == 1 && matches!(path.components().next(), Some(Component::Normal(_)))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_trusted_url(value: &str, bundled: bool) -> bool {
    let prefix = if bundled {
        format!("https://github.com/google/fonts/blob/{SOURCE_REVISION}/ofl/")
    } else {
        format!("https://raw.githubusercontent.com/google/fonts/{SOURCE_REVISION}/ofl/")
    };
    value.strip_prefix(&prefix).is_some_and(|path| {
        !path.is_empty() && !path.contains("..") && !path.contains(['?', '#', '\\'])
    })
}
