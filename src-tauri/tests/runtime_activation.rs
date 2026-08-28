use vrct_lib::runtime_activation::{RuntimeActivationContext, RuntimeActivationError};

#[test]
fn activation_context_requires_both_launch_arguments() {
    let missing_token = RuntimeActivationContext::from_launch_args([
        "VRCNT.exe",
        "--runtime-activation-pipe",
        "vrcnt-activation-test",
    ]);

    assert!(matches!(
        missing_token,
        Err(RuntimeActivationError::MissingArguments)
    ));
}

#[test]
fn activation_context_completes_only_once_for_the_bound_token_and_nonce() {
    let context = RuntimeActivationContext::from_launch_args([
        "VRCNT.exe",
        "--runtime-activation-pipe",
        "vrcnt-activation-test",
        "--runtime-activation-token",
        "activation-token",
    ])
    .unwrap()
    .unwrap();
    let nonce = context.frontend_context().unwrap().nonce;
    let mut delivered = Vec::new();

    assert!(matches!(
        context.complete_if_matches("wrong-token", &nonce, |message| {
            delivered.push(message);
            Ok(())
        }),
        Err(RuntimeActivationError::TokenMismatch)
    ));
    assert!(context
        .complete_if_matches("activation-token", &nonce, |message| {
            delivered.push(message);
            Ok(())
        })
        .is_ok());
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].protocol_version, 1);
    assert_eq!(delivered[0].status, "ready");
    assert_eq!(delivered[0].token, "activation-token");
    assert_eq!(delivered[0].nonce, nonce);
    assert!(matches!(
        context.complete_if_matches("activation-token", &nonce, |_| Ok(())),
        Err(RuntimeActivationError::AlreadyCompleted)
    ));
}
