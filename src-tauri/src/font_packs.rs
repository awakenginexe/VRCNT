use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const SCHEMA_VERSION: u32 = 1;
const SOURCE_REVISION: &str = "2796410152d4f9524b68ed46e69c1b60f8e0f7c3";
const ALLOWED_PACK_IDS: &[&str] = &[
    "latin-greek-cyrillic", "thai", "japanese", "cjk-simplified", "cjk-traditional", "korean",
    "lao", "khmer", "myanmar", "devanagari", "arabic", "cjk-hong-kong", "urdu", "ethiopic",
    "armenian", "bengali", "georgian", "gujarati", "hebrew", "kannada", "malayalam", "sinhala",
    "tamil", "telugu", "emoji",
];

static CACHE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontManifest {
    pub schema_version: u32,
    pub manifest_version: String,
    pub font_family_version: String,
    pub source_revision: String,
    pub packs: std::collections::BTreeMap<String, FontPack>,
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

impl FontManifest {
    pub fn parse(json: &str) -> Result<Self, String> {
        let manifest: Self = serde_json::from_str(json).map_err(|error| format!("Invalid font manifest JSON: {error}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let json = fs::read_to_string(path).map_err(|error| format!("Unable to read font manifest: {error}"))?;
        Self::parse(&json)
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION { return Err("Unsupported font manifest schema version".into()); }
        if self.manifest_version.trim().is_empty() || self.font_family_version.trim().is_empty() || self.source_revision != SOURCE_REVISION { return Err("Invalid font manifest identity".into()); }
        if self.packs.is_empty() { return Err("Font manifest has no packs".into()); }
        let mut paths = HashSet::new();
        for (id, pack) in &self.packs {
            if !ALLOWED_PACK_IDS.contains(&id.as_str()) || pack.display_name.trim().is_empty() || pack.scripts.is_empty() || pack.family.trim().is_empty() || pack.source_family.trim().is_empty() || pack.pack_version.trim().is_empty() || pack.license_spdx != "OFL-1.1" || pack.copyright_notice.trim().is_empty() { return Err(format!("Invalid font pack: {id}")); }
            if pack.files.is_empty() || !pack.files.iter().any(|file| file.role == "license" && file.relative_path == "OFL.txt") { return Err(format!("Font pack missing OFL license: {id}")); }
            for file in &pack.files {
                if !is_safe_file_name(&file.relative_path) || !paths.insert((id.clone(), file.relative_path.clone())) || file.expected_bytes == 0 || !is_sha256(&file.sha256) || file.license_spdx != "OFL-1.1" || file.source_revision != SOURCE_REVISION || !is_trusted_url(&file.source_url, pack.bundled) { return Err(format!("Invalid font file for {id}")); }
                match file.role.as_str() {
                    "web-and-pillow" | "font" if file.format == "ttf" && file.relative_path.ends_with(".ttf") && file.weight_range.is_some() => {},
                    "license" if file.format == "text" && file.relative_path == "OFL.txt" => {},
                    _ => return Err(format!("Unsupported font file role for {id}")),
                }
            }
        }
        Ok(())
    }

    pub fn pack(&self, pack_id: &str) -> Result<&FontPack, String> { self.packs.get(pack_id).ok_or_else(|| "Unknown font pack".into()) }
}

pub struct FontCache { root: PathBuf, manifest: FontManifest }

impl FontCache {
    pub fn open_at(root: PathBuf, manifest: FontManifest) -> Result<Self, String> {
        fs::create_dir_all(root.join(".staging")).map_err(io_error)?;
        fs::create_dir_all(root.join("packs")).map_err(io_error)?;
        Ok(Self { root, manifest })
    }
    pub fn staging_root(&self) -> PathBuf { self.root.join(".staging") }
    pub fn default_root() -> PathBuf {
        let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("APPDATA")).map(PathBuf::from).unwrap_or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")));
        let current = base.join("VRCNTData"); let legacy = base.join("VRCNT-NextData");
        if current.exists() || !legacy.exists() { current.join("fonts") } else { legacy.join("fonts") }
    }
    pub fn recover(&self) -> Result<(), String> {
        let _guard = CACHE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| "Font cache lock poisoned")?;
        if self.staging_root().is_dir() { for item in fs::read_dir(self.staging_root()).map_err(io_error)? { let item = item.map_err(io_error)?; if item.path().is_dir() { fs::remove_dir_all(item.path()).map_err(io_error)?; } } }
        Ok(())
    }
    pub fn install_from_directory(&self, pack_id: &str, source: &Path) -> Result<(), String> {
        let _guard = CACHE_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| "Font cache lock poisoned")?;
        let pack = self.manifest.pack(pack_id)?.clone();
        if pack.bundled { return Err("Bundled font packs are not cache-installable".into()); }
        verify_files(&pack, source)?;
        let staging = self.staging_root().join(format!("{pack_id}-{}", unique_id()));
        fs::create_dir_all(&staging).map_err(io_error)?;
        for file in &pack.files { fs::copy(source.join(&file.relative_path), staging.join(&file.relative_path)).map_err(io_error)?; }
        if let Err(error) = verify_files(&pack, &staging) { let _ = fs::remove_dir_all(&staging); return Err(error); }
        let marker = InstalledPack { pack_id: pack_id.into(), pack_version: pack.pack_version.clone(), manifest_version: self.manifest.manifest_version.clone(), files: pack.files.iter().map(|file| InstalledFile { relative_path: file.relative_path.clone(), expected_bytes: file.expected_bytes, sha256: file.sha256.clone() }).collect() };
        fs::write(staging.join("installed.v1.json"), serde_json::to_vec(&marker).map_err(|error| error.to_string())?).map_err(io_error)?;
        let final_dir = self.root.join("packs").join(pack_id).join(&pack.pack_version);
        fs::create_dir_all(final_dir.parent().ok_or("Invalid cache path")?).map_err(io_error)?;
        if final_dir.exists() { fs::remove_dir_all(&staging).map_err(io_error)?; return Ok(()); }
        fs::rename(&staging, &final_dir).map_err(io_error)
    }
    pub fn installed_pack(&self, pack_id: &str) -> Result<Option<InstalledPack>, String> {
        let pack = self.manifest.pack(pack_id)?;
        let directory = self.root.join("packs").join(pack_id).join(&pack.pack_version);
        let marker = directory.join("installed.v1.json");
        if !marker.is_file() { return Ok(None); }
        let installed: InstalledPack = serde_json::from_slice(&fs::read(&marker).map_err(io_error)?).map_err(|_| "Invalid installed font marker")?;
        if installed.pack_id != pack_id || installed.pack_version != pack.pack_version || verify_files(pack, &directory).is_err() { let _ = fs::remove_dir_all(&directory); return Ok(None); }
        Ok(Some(installed))
    }
    pub fn total_verified_bytes(&self) -> Result<u64, String> {
        let mut total = 0; for id in self.manifest.packs.keys() { if let Some(installed) = self.installed_pack(id)? { total += installed.files.iter().map(|file| file.expected_bytes).sum::<u64>(); } } Ok(total)
    }
    pub fn remove_optional_pack(&self, pack_id: &str) -> Result<(), String> {
        if self.manifest.pack(pack_id)?.bundled { return Err("Bundled font packs cannot be removed".into()); }
        let directory = self.root.join("packs").join(pack_id); if directory.exists() { fs::remove_dir_all(directory).map_err(io_error)?; } Ok(())
    }
}

fn verify_files(pack: &FontPack, directory: &Path) -> Result<(), String> { for file in &pack.files { let contents = fs::read(directory.join(&file.relative_path)).map_err(io_error)?; if contents.len() as u64 != file.expected_bytes || sha256(&contents) != file.sha256 { return Err("Font pack integrity verification failed".into()); } } Ok(()) }
fn sha256(contents: &[u8]) -> String { format!("{:x}", Sha256::digest(contents)) }
fn io_error(error: std::io::Error) -> String { error.to_string() }
fn unique_id() -> String { format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()) }
fn is_safe_file_name(value: &str) -> bool { let path = Path::new(value); path.components().count() == 1 && matches!(path.components().next(), Some(Component::Normal(_))) }
fn is_sha256(value: &str) -> bool { value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) }
fn is_trusted_url(value: &str, bundled: bool) -> bool { let Some(rest) = value.strip_prefix("https://") else { return false }; if bundled { rest.starts_with("github.com/google/fonts/blob/") } else { rest.starts_with("github.com/awakenginexe/VRCNT/releases/download/font-packs-v1/") } }
