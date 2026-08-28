use sha2::{Digest, Sha256};
use std::fs;
use tempfile::tempdir;
use vrct_lib::runtime_manager::{
    read_runtime_state_from_data_root, resolve_stable_manager_path, RuntimeVariant,
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
