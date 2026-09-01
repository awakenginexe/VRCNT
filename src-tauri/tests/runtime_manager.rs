use sha2::{Digest, Sha256};
use std::fs;
use tempfile::tempdir;
use vrct_lib::runtime_manager::{
    consume_runtime_switch_receipt_at, persist_runtime_switch_receipt_binding,
    read_runtime_state_from_data_root, recover_abandoned_runtime_switch,
    recover_abandoned_runtime_switch_with_before_commit, resolve_stable_manager_path,
    runtime_switch_receipt_mac, stage_manager_signature_for_verification,
    validate_shutdown_request_status, RuntimeSwitchHandoff, RuntimeVariant,
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
fn legacy_pascal_case_runtime_state_is_exposed_to_the_frontend() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let install_path = temporary.path().join("VRCNT");
    write_active_runtime(&data_root, &install_path);

    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(data_root.join("runtime.json")).unwrap()).unwrap();
    let legacy_state = serde_json::json!({
        "Schema": state["schema"],
        "Status": state["status"],
        "Product": state["product"],
        "Version": state["version"],
        "Variant": state["variant"],
        "Architecture": state["architecture"],
        "InstallPath": state["installPath"],
        "MarkerBuildIdentity": state["markerBuildIdentity"],
        "MarkerSha256": state["markerSha256"],
        "UpdatedAtUtc": state["updatedAtUtc"],
    });
    fs::write(data_root.join("runtime.json"), serde_json::to_vec(&legacy_state).unwrap()).unwrap();

    assert_eq!(
        read_runtime_state_from_data_root(&data_root).unwrap().status,
        "active"
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
        install_path: temporary.path().to_path_buf(),
        lease_generation: 1,
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
        proof: vrct_lib::runtime_manager::switch_proof_for_test(
            "old-token",
            "old-nonce",
            "cuda",
            &app_path,
        ),
        status_path: status_path.clone(),
        current_app_path: app_path.clone(),
        install_path: temporary.path().to_path_buf(),
        lease_generation: 2,
    };
    fs::write(
        &status_path,
        serde_json::json!({
            "schema": 1,
            "status": "running",
            "targetVariant": "cuda",
            "nonce": "old-nonce",
            "tokenSha256": format!("{:x}", Sha256::digest(b"old-token")),
            "proofSha256": handoff.proof,
            "currentAppPath": app_path,
            "installPath": temporary.path(),
            "updatedAtUtc": "2026-08-28T00:00:00Z",
            "managerProcessId": 424242,
            "handoffExpiresAtUtc": "2026-08-28T00:01:00Z",
            "leaseGeneration": 2
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
fn an_expired_handoff_with_a_live_manager_is_not_revoked() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"old runtime remains alive").unwrap();
    let handoff = RuntimeSwitchHandoff {
        nonce: "live-nonce".to_owned(),
        token: "live-token".to_owned(),
        target_variant: "cuda".to_owned(),
        proof: vrct_lib::runtime_manager::switch_proof_for_test(
            "live-token",
            "live-nonce",
            "cuda",
            &app_path,
        ),
        status_path: status_path.clone(),
        current_app_path: app_path.clone(),
        install_path: temporary.path().to_path_buf(),
        lease_generation: 7,
    };
    fs::write(
        &status_path,
        serde_json::json!({
            "schema": 1,
            "status": "running",
            "targetVariant": "cuda",
            "nonce": "live-nonce",
            "tokenSha256": format!("{:x}", Sha256::digest(b"live-token")),
            "proofSha256": handoff.proof,
            "currentAppPath": app_path,
            "installPath": temporary.path(),
            "updatedAtUtc": "2026-08-28T00:00:00.000Z",
            "managerProcessId": 424242,
            "handoffExpiresAtUtc": "2026-08-28T00:01:00.000Z",
            "leaseGeneration": 7
        })
        .to_string(),
    )
    .unwrap();

    assert!(!recover_abandoned_runtime_switch(
        &handoff,
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_788_000_120),
        |_| true,
    )
    .unwrap());
    let current: serde_json::Value =
        serde_json::from_slice(&fs::read(&status_path).unwrap()).unwrap();
    assert_eq!(current["status"], "running");
    assert!(app_path.is_file());
}

#[test]
fn a_manager_revoked_during_expiry_cannot_write_a_late_shutdown_request() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"old runtime remains alive").unwrap();
    let handoff = RuntimeSwitchHandoff {
        nonce: "revoked-nonce".to_owned(),
        token: "revoked-token".to_owned(),
        target_variant: "cuda".to_owned(),
        proof: vrct_lib::runtime_manager::switch_proof_for_test(
            "revoked-token",
            "revoked-nonce",
            "cuda",
            &app_path,
        ),
        status_path: status_path.clone(),
        current_app_path: app_path.clone(),
        install_path: temporary.path().to_path_buf(),
        lease_generation: 8,
    };
    fs::write(
        &status_path,
        serde_json::json!({
            "schema": 1,
            "status": "running",
            "targetVariant": "cuda",
            "nonce": "revoked-nonce",
            "tokenSha256": format!("{:x}", Sha256::digest(b"revoked-token")),
            "proofSha256": handoff.proof,
            "currentAppPath": app_path,
            "installPath": temporary.path(),
            "updatedAtUtc": "2026-08-28T00:00:00.000Z",
            "managerProcessId": 424242,
            "handoffExpiresAtUtc": "2026-08-28T00:01:00.000Z",
            "leaseGeneration": 8
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

    assert!(validate_shutdown_request_status(&handoff).is_err());
    let current: serde_json::Value =
        serde_json::from_slice(&fs::read(&status_path).unwrap()).unwrap();
    assert_eq!(current["status"], "stale");
    assert_eq!(current["leaseGeneration"], 8);
}

#[test]
fn a_terminal_receipt_is_authenticated_consumed_once_and_rejects_forged_or_expired_records() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"runtime").unwrap();
    let binding = vrct_lib::runtime_manager::persist_runtime_switch_receipt_binding(
        &data_root,
        "nonce",
        "cuda",
        &temporary.path().to_path_buf(),
        &app_path,
        "token",
        9,
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(1_787_875_260_000),
    )
    .unwrap();
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
        "installPath": temporary.path(),
        "leaseGeneration": 9,
        "errorCode": "activation_unhealthy",
        "message": "The CUDA runtime was rolled back.",
        "updatedAtUtc": "2026-08-28T00:00:00Z",
        "receiptExpiresAtUnixMs": expires,
    });
    record["tokenSha256"] = serde_json::Value::String(format!("{:x}", Sha256::digest(b"token")));
    let canonical_app_path = fs::canonicalize(&app_path).unwrap();
    record["proofSha256"] = serde_json::Value::String(
        vrct_lib::runtime_manager::switch_proof_for_test(
            "token",
            "nonce",
            "cuda",
            &canonical_app_path,
        ),
    );
    record["receiptMac"] = serde_json::Value::String(
        runtime_switch_receipt_mac(&record, &binding.receipt_secret).unwrap(),
    );
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

    let binding = persist_runtime_switch_receipt_binding(
        &data_root,
        "nonce",
        "cuda",
        &temporary.path().to_path_buf(),
        &app_path,
        "token",
        9,
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(1_787_875_260_000),
    )
    .unwrap();
    record["receiptMac"] = serde_json::Value::String("forged".to_owned());
    fs::write(&status_path, record.to_string()).unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());

    record["receiptExpiresAtUnixMs"] = serde_json::Value::from(issued - 1);
    record["receiptMac"] = serde_json::Value::String(
        runtime_switch_receipt_mac(&record, &binding.receipt_secret).unwrap(),
    );
    fs::write(&status_path, record.to_string()).unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());

    fs::write(&status_path, "not a receipt").unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());
}

#[test]
fn recovery_compare_and_swap_does_not_revoke_a_newer_retry_that_wins_the_interleaving() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"runtime remains alive").unwrap();
    let old_handoff = RuntimeSwitchHandoff {
        nonce: "old-nonce".to_owned(),
        token: "old-token".to_owned(),
        target_variant: "cuda".to_owned(),
        proof: vrct_lib::runtime_manager::switch_proof_for_test(
            "old-token",
            "old-nonce",
            "cuda",
            &app_path,
        ),
        status_path: status_path.clone(),
        current_app_path: app_path.clone(),
        install_path: temporary.path().to_path_buf(),
        lease_generation: 3,
    };
    fs::write(
        &status_path,
        serde_json::json!({
            "schema": 1,
            "status": "running",
            "targetVariant": "cuda",
            "nonce": "old-nonce",
            "tokenSha256": format!("{:x}", Sha256::digest(b"old-token")),
            "proofSha256": old_handoff.proof,
            "currentAppPath": app_path,
            "installPath": temporary.path(),
            "updatedAtUtc": "2026-08-28T00:00:00.000Z",
            "managerProcessId": 424242,
            "handoffExpiresAtUtc": "2026-08-28T00:01:00.000Z",
            "leaseGeneration": 3
        })
        .to_string(),
    )
    .unwrap();

    let newer_proof = vrct_lib::runtime_manager::switch_proof_for_test(
        "new-token",
        "new-nonce",
        "cuda",
        &app_path,
    );
    let newer_status = serde_json::json!({
        "schema": 1,
        "status": "pending",
        "targetVariant": "cuda",
        "nonce": "new-nonce",
        "tokenSha256": format!("{:x}", Sha256::digest(b"new-token")),
        "proofSha256": newer_proof,
        "currentAppPath": app_path,
        "installPath": temporary.path(),
        "updatedAtUtc": "2026-08-28T00:02:00.000Z",
        "leaseGeneration": 4
    });
    assert!(!recover_abandoned_runtime_switch_with_before_commit(
        &old_handoff,
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_788_000_120),
        |_| false,
        || fs::write(&status_path, newer_status.to_string()).unwrap(),
    )
    .unwrap());
    let current: serde_json::Value =
        serde_json::from_slice(&fs::read(&status_path).unwrap()).unwrap();
    assert_eq!(current["nonce"], "new-nonce");
    assert_eq!(current["leaseGeneration"], 4);
    assert_eq!(current["status"], "pending");
}

#[test]
fn correctly_macd_receipts_with_wrong_transaction_fields_are_rejected() {
    let temporary = tempdir().unwrap();
    let data_root = temporary.path().join("VRCNTData");
    let app_path = temporary.path().join("VRCNT.exe");
    let other_app = temporary.path().join("OtherVRCNT.exe");
    let status_path = data_root.join("runtime-switch-status.json");
    fs::create_dir_all(&data_root).unwrap();
    fs::write(&app_path, b"runtime").unwrap();
    fs::write(&other_app, b"other runtime").unwrap();
    let other_install = temporary.path().join("other-install");
    fs::create_dir_all(&other_install).unwrap();
    let binding = persist_runtime_switch_receipt_binding(
        &data_root,
        "nonce",
        "cuda",
        &temporary.path().to_path_buf(),
        &app_path,
        "token",
        10,
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(1_787_875_260_000),
    )
    .unwrap();
    let base = serde_json::json!({
        "schema": 1,
        "status": "failed",
        "targetVariant": "cuda",
        "nonce": "nonce",
        "tokenSha256": format!("{:x}", Sha256::digest(b"token")),
        "proofSha256": vrct_lib::runtime_manager::switch_proof_for_test("token", "nonce", "cuda", &app_path),
        "currentAppPath": app_path,
        "installPath": temporary.path(),
        "leaseGeneration": 10,
        "updatedAtUtc": "2026-08-28T00:00:00Z",
        "receiptExpiresAtUnixMs": binding.receipt_expires_at_unix_ms
    });
    let now =
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(1_787_875_201_000);
    for (field, value) in [
        ("nonce", serde_json::json!("wrong-nonce")),
        ("targetVariant", serde_json::json!("cpu")),
        ("tokenSha256", serde_json::json!("a".repeat(64))),
        ("proofSha256", serde_json::json!("b".repeat(64))),
        ("currentAppPath", serde_json::json!(other_app)),
    ] {
        let mut invalid = base.clone();
        invalid[field] = value;
        invalid["receiptMac"] = serde_json::Value::String(
            runtime_switch_receipt_mac(&invalid, &binding.receipt_secret).unwrap(),
        );
        fs::write(&status_path, invalid.to_string()).unwrap();
        assert!(
            consume_runtime_switch_receipt_at(&data_root, &app_path, now,).is_err(),
            "field {field} unexpectedly authorized a receipt"
        );
    }
    let mut invalid_install = base.clone();
    invalid_install["installPath"] = serde_json::json!(other_install);
    invalid_install["receiptMac"] = serde_json::Value::String(
        runtime_switch_receipt_mac(&invalid_install, &binding.receipt_secret).unwrap(),
    );
    fs::write(&status_path, invalid_install.to_string()).unwrap();
    assert!(consume_runtime_switch_receipt_at(&data_root, &app_path, now).is_err());
}
