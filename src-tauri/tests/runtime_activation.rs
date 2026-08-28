use vrct_lib::runtime_activation::{RuntimeActivationContext, RuntimeActivationError};

#[test]
fn activation_context_requires_all_manager_issued_arguments() {
    let missing_nonce = RuntimeActivationContext::from_launch_args([
        "VRCNT.exe", "--runtime-activation-pipe", "vrcnt-activation-test",
        "--runtime-activation-token", "activation-token",
        "--runtime-activation-app-version", "5.15.0",
        "--runtime-activation-runtime-variant", "cpu",
    ]);

    assert!(matches!(missing_nonce, Err(RuntimeActivationError::MissingArguments)));
}

#[test]
fn activation_context_preserves_the_manager_issued_proof_binding() {
    let context = RuntimeActivationContext::from_launch_args([
        "VRCNT.exe", "--runtime-activation-pipe", "vrcnt-activation-test",
        "--runtime-activation-token", "activation-token",
        "--runtime-activation-nonce", "manager-nonce",
        "--runtime-activation-app-version", "5.15.0",
        "--runtime-activation-runtime-variant", "cpu",
    ]).unwrap().unwrap();

    assert_eq!(context.frontend_context().unwrap().nonce, "manager-nonce");
}

#[test]
fn activation_mode_rejects_renderer_boolean_bypass() {
    let context = RuntimeActivationContext::from_launch_args([
        "VRCNT.exe", "--runtime-activation-pipe", "vrcnt-activation-test",
        "--runtime-activation-token", "activation-token",
        "--runtime-activation-nonce", "manager-nonce",
        "--runtime-activation-app-version", "5.15.0",
        "--runtime-activation-runtime-variant", "cpu",
    ]).unwrap().unwrap();

    assert!(matches!(context.reject_renderer_ready_signal(), Err(RuntimeActivationError::RendererProofRejected)));
}

#[test]
fn non_activation_startup_remains_available() {
    assert!(RuntimeActivationContext::from_launch_args(["VRCNT.exe"]).unwrap().is_none());
}
