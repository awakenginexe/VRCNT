#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_targets_reject_downgrades_wrong_channels_and_path_injection() {
        assert!(validate_release_target("6.0.0-rc.2", "v6.0.0-rc.3").is_ok());
        assert!(validate_release_target("6.0.0-rc.2", "v6.0.0").is_ok());
        assert!(validate_release_target("5.13.0", "v5.16.0").is_ok());
        for (current, target) in [
            ("5.13.0", "v6.0.0-rc.3"),
            ("6.0.0", "v7.0.0-rc.1"),
            ("6.0.0-rc.3", "v6.0.0-rc.2"),
            ("5.16.0", "v5.16.0"),
            ("5.13.0", "../../attack"),
        ] {
            assert!(validate_release_target(current, target).is_err());
        }
    }
}
use semver::Version;
use serde::Serialize;
use std::time::Duration;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub fn get_installed_release_version() -> String {
    option_env!("VRCNT_RUNTIME_RELEASE_TAG")
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .trim_start_matches('v')
        .to_owned()
}

fn parse_release(value: &str) -> Result<Version, String> {
    let version = Version::parse(value.strip_prefix('v').unwrap_or(value))
        .map_err(|_| "Invalid release version".to_owned())?;
    if !version.build.is_empty() {
        return Err("Release build metadata is unsupported".into());
    }
    if !version.pre.is_empty() {
        let number = version
            .pre
            .as_str()
            .strip_prefix("rc.")
            .and_then(|number| number.parse::<u64>().ok());
        if !matches!(number, Some(1..)) {
            return Err("Unsupported release channel".into());
        }
    }
    Ok(version)
}

fn validate_release_target(current: &str, target: &str) -> Result<Version, String> {
    let installed = parse_release(current)?;
    let target = parse_release(target)?;
    if target <= installed || (installed.pre.is_empty() && !target.pre.is_empty()) {
        return Err("Release is not a newer version on this installation's channel".into());
    }
    Ok(target)
}

pub fn is_newer_allowed_release(target: &Version) -> bool {
    validate_release_target(&get_installed_release_version(), &target.to_string()).is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

// Register the plugin's own Update resource so its signature verification,
// installation, progress events, and cleanup remain the standard signed path.
#[tauri::command]
pub async fn check_release_update(
    webview: Webview,
    release_tag: String,
) -> Result<Option<UpdateMetadata>, String> {
    let installed = get_installed_release_version();
    let target = validate_release_target(&installed, &release_tag)?;
    let endpoint =
        format!("https://github.com/awakenginexe/VRCNT/releases/download/v{target}/latest.json");
    let expected = target.clone();
    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint
            .parse()
            .map_err(|_| "Invalid update endpoint")?])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(15))
        .version_comparator(move |_, remote| remote.version == expected)
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    Ok(update.map(|update| UpdateMetadata {
        current_version: installed,
        version: update.version.clone(),
        date: None,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}
