use sha2::{Digest, Sha256};
use std::fs;
use tempfile::tempdir;
use vrct_lib::runtime_manager::{
    consume_runtime_switch_receipt_at, persist_runtime_switch_receipt_secret,
    read_runtime_state_from_data_root, recover_abandoned_runtime_switch,
    resolve_stable_manager_path, runtime_switch_receipt_mac,
    stage_manager_signature_for_verification, validate_shutdown_request_status,
    RuntimeSwitchHandoff, RuntimeVariant,
};

fn write_active_runtime(data_root: &std::path::Path, install_path: &std::path::Path) {
    fs::create_dir_all(data_root).unwrap();
    fs::create_dir_all(install_path).unwrap();
    fs::write(install_path.join("VRCNT.exe"), b"shell").unwrap();
    fs::write(install_path.join("VRCNT-backend.exe"), b"backend").unwrap();
    let marker = r#"{"product":"VRCNT","version":"5.15.0","variant":"Cpu","architecture":"x64","buildIdentity":"fixture"}"#;
    fs::write(install_path.join("VRCNT.runtime.json"), marker).unwrap();
    let marker_hash = format!("{:x}", Sha256::digest(marker.as_bytes()));
    let state = serde_json::json!({
        "schema": 1,
        "status": "Active",
        "product": "VRCNT",
        "version": "5.15.0",
        "variant": "Cpu",
        "architecture": "x64",
        "installPath": install_path,
        "markerBuildIdentity": "fixture",
        "markerSha256": marker_hash,
        "updatedAtUtc": "2026-08-28T00:00:00Z"
    });
    fs::write(
        data_root.join("runtime.json"),
        serde_json::to_vec(&state).unwrap(),
    )
    .unwrap();
}

#[test]
fn only_a_physically_valid_active_runtime_is_exposed_to_the_frontend() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let install_path = temporary.path().join("VRCNT");
    write_active_runtime(&data_root, &install_path);

    let state = read_runtime_state_from_data_root(&data_root).unwrap();
    assert_eq!(state.status, "active");
    assert_eq!(state.variant, "cpu");
    assert_eq!(
        state.install_path,
        install_path.canonicalize().unwrap().display().to_string()
    );

    fs::write(install_path.join("VRCNT.runtime.json"), "{}").unwrap();
    assert_eq!(
        read_runtime_state_from_data_root(&data_root)
            .unwrap()
            .status,
        "recovery"
    );
}

#[test]
fn runtime_switch_variants_are_a_closed_cpu_cuda_set() {
    assert_eq!(RuntimeVariant::parse("cpu").unwrap(), RuntimeVariant::Cpu);
    assert_eq!(RuntimeVariant::parse("cuda").unwrap(), RuntimeVariant::Cuda);
    assert!(RuntimeVariant::parse("C:\\Windows\\System32\\cmd.exe").is_err());
}

#[test]
fn stable_manager_resolution_uses_only_the_local_appdata_lifecycle_path() {
    let temporary = tempdir().unwrap();
    let manager = resolve_stable_manager_path(temporary.path()).unwrap();
    assert_eq!(
        manager,
        temporary
            .path()
            .join("VRCNTInstaller")
            .join("VRCNT.Setup.exe")
    );
}

#[test]
fn manager_verification_stages_the_release_multiline_minisign_file_without_reencoding() {
    let temporary = tempdir().unwrap();
    let signature = "untrusted comment: signature from minisign secret key\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\ntrusted comment: timestamp: 1787932800\nRUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n";

    let staged = stage_manager_signature_for_verification(temporary.path(), signature).unwrap();

    assert_eq!(fs::read(staged).unwrap(), signature.as_bytes());
}

#[test]
fn an_expired_or_terminal_status_cannot_authorize_runtime_shutdown() {
    let temporary = tempdir().unwrap();
    let status_path = temporary.path().join("runtime-switch-status.json");
    let app_path = temporary.path().join("VRCNT.exe");
    let handoff = RuntimeSwitchHandoff {
        nonce: "nonce".to_owned(),
        token: "token".to_owned(),
        target_variant: "cuda".to_owned(),
        proof: "proof".to_owned(),
        status_path: status_path.clone(),
        current_app_path: app_path.clone(),
    };
    fs::write(
        &status_path,
        serde_json::json!({
            "schema": 1,
            "status": "cancelled",
            "targetVariant": "cuda",
            "nonce": "nonce",
            "tokenSha256": "not-a-valid-request",
            "proofSha256": "proof",
            "currentAppPath": app_path,
        })
        .to_string(),
    )
    .unwrap();

    assert!(validate_shutdown_request_status(&handoff).is_err());
}

#[test]
fn an_abandoned_pre_quiesce_manager_is_marked_stale_without_stopping_the_old_runtime_and_a_retry_can_begin(
) {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"old runtime remains alive").unwrap();
    let handoff = RuntimeSwitchHandoff {
        nonce: "old-nonce".to_owned(),
        token: "old-token".to_owned(),
        target_variant: "cuda".to_owned(),
        proof: "old-proof".to_owned(),
        status_path: status_path.clone(),
        current_app_path: app_path.clone(),
    };
    fs::write(
        &status_path,
        serde_json::json!({
            "schema": 1,
            "status": "running",
            "targetVariant": "cuda",
            "nonce": "old-nonce",
            "tokenSha256": format!("{:x}", Sha256::digest(b"old-token")),
            "proofSha256": "old-proof",
            "currentAppPath": app_path,
            "updatedAtUtc": "2026-08-28T00:00:00Z",
            "managerProcessId": 424242,
            "handoffExpiresAtUtc": "2026-08-28T00:01:00Z"
        })
        .to_string(),
    )
    .unwrap();

    assert!(recover_abandoned_runtime_switch(
        &handoff,
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_788_000_120),
        |_| false,
    )
    .unwrap());
    assert!(app_path.is_file());
    let recovered: serde_json::Value =
        serde_json::from_slice(&fs::read(&status_path).unwrap()).unwrap();
    assert_eq!(recovered["status"], "stale");
    assert_eq!(recovered["nonce"], "old-nonce");
}

#[test]
fn a_terminal_receipt_is_authenticated_consumed_once_and_rejects_forged_or_expired_records() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"runtime").unwrap();
    persist_runtime_switch_receipt_secret(&data_root, "nonce", "receipt-secret").unwrap();
    let issued = 1_787_875_200_000i64;
    let expires = issued + 60_000;
    let mut record = serde_json::json!({
        "schema": 1,
        "status": "failed",
        "targetVariant": "cuda",
        "nonce": "nonce",
        "tokenSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "proofSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "currentAppPath": app_path,
        "errorCode": "activation_unhealthy",
        "message": "The CUDA runtime was rolled back.",
        "updatedAtUtc": "2026-08-28T00:00:00Z",
        "receiptExpiresAtUnixMs": expires,
    });
    record["receiptMac"] =
        serde_json::Value::String(runtime_switch_receipt_mac(&record, "receipt-secret").unwrap());
    fs::write(&status_path, record.to_string()).unwrap();

    let now = std::time::SystemTime::UNIX_EPOCH
        + std::time::Duration::from_millis((issued + 1_000) as u64);
    assert_eq!(
        consume_runtime_switch_receipt_at(&data_root, &app_path, now)
            .unwrap()
            .unwrap()
            .status,
        "failed"
    );
    assert!(
        consume_runtime_switch_receipt_at(&data_root, &app_path, now)
            .unwrap()
            .is_none()
    );

    persist_runtime_switch_receipt_secret(&data_root, "nonce", "receipt-secret").unwrap();
    record["receiptMac"] = serde_json::Value::String("forged".to_owned());
    fs::write(&status_path, record.to_string()).unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());

    record["receiptExpiresAtUnixMs"] = serde_json::Value::from(issued - 1);
    record["receiptMac"] =
        serde_json::Value::String(runtime_switch_receipt_mac(&record, "receipt-secret").unwrap());
    fs::write(&status_path, record.to_string()).unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());

    fs::write(&status_path, "not a receipt").unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());
}
