use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const RUNTIME_ACTIVATION_PIPE_ARGUMENT: &str = "--runtime-activation-pipe";
pub const RUNTIME_ACTIVATION_TOKEN_ARGUMENT: &str = "--runtime-activation-token";
pub const RUNTIME_ACTIVATION_NONCE_ARGUMENT: &str = "--runtime-activation-nonce";
pub const RUNTIME_ACTIVATION_APP_VERSION_ARGUMENT: &str = "--runtime-activation-app-version";
pub const RUNTIME_ACTIVATION_RUNTIME_VARIANT_ARGUMENT: &str = "--runtime-activation-runtime-variant";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActivationFrontendContext {
    pub pipe_name: String,
    pub activation_token: String,
    pub nonce: String,
    pub app_version: String,
    pub runtime_variant: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeActivationError {
    MissingArguments,
    InvalidPipeName,
    InvalidRuntimeVariant,
    RendererProofRejected,
}

impl std::fmt::Display for RuntimeActivationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for RuntimeActivationError {}

#[derive(Debug)]
pub struct RuntimeActivationContext {
    binding: Option<RuntimeActivationFrontendContext>,
    renderer_signal_rejected: Mutex<bool>,
}

impl RuntimeActivationContext {
    pub fn from_launch_args<I, S>(args: I) -> Result<Option<Self>, RuntimeActivationError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let arguments: Vec<String> = args.into_iter().map(|argument| argument.as_ref().to_owned()).collect();
        let mut pipe_name = None;
        let mut activation_token = None;
        let mut nonce = None;
        let mut app_version = None;
        let mut runtime_variant = None;
        let mut activation_mode = false;

        let mut index = 0;
        while index < arguments.len() {
            let value = value_after(&arguments, index);
            match arguments[index].as_str() {
                RUNTIME_ACTIVATION_PIPE_ARGUMENT => { activation_mode = true; pipe_name = value; }
                RUNTIME_ACTIVATION_TOKEN_ARGUMENT => { activation_mode = true; activation_token = value; }
                RUNTIME_ACTIVATION_NONCE_ARGUMENT => { activation_mode = true; nonce = value; }
                RUNTIME_ACTIVATION_APP_VERSION_ARGUMENT => { activation_mode = true; app_version = value; }
                RUNTIME_ACTIVATION_RUNTIME_VARIANT_ARGUMENT => { activation_mode = true; runtime_variant = value; }
                _ => {}
            }
            index += 1;
        }

        if !activation_mode {
            return Ok(None);
        }
        let (Some(pipe_name), Some(activation_token), Some(nonce), Some(app_version), Some(runtime_variant)) =
            (pipe_name, activation_token, nonce, app_version, runtime_variant) else {
                return Err(RuntimeActivationError::MissingArguments);
            };
        if !is_valid_pipe_name(&pipe_name) {
            return Err(RuntimeActivationError::InvalidPipeName);
        }
        if activation_token.trim().is_empty() || nonce.trim().is_empty() || app_version.trim().is_empty() {
            return Err(RuntimeActivationError::MissingArguments);
        }
        if !matches!(runtime_variant.as_str(), "cpu" | "cuda") {
            return Err(RuntimeActivationError::InvalidRuntimeVariant);
        }

        Ok(Some(Self {
            binding: Some(RuntimeActivationFrontendContext { pipe_name, activation_token, nonce, app_version, runtime_variant }),
            renderer_signal_rejected: Mutex::new(false),
        }))
    }

    pub fn inactive() -> Self {
        Self { binding: None, renderer_signal_rejected: Mutex::new(false) }
    }

    pub fn frontend_context(&self) -> Option<RuntimeActivationFrontendContext> {
        self.binding.clone()
    }

    /// Renderer/webview input is deliberately never a readiness authority.
    pub fn reject_renderer_ready_signal(&self) -> Result<bool, RuntimeActivationError> {
        let mut rejected = self.renderer_signal_rejected.lock().map_err(|_| RuntimeActivationError::RendererProofRejected)?;
        *rejected = true;
        Err(RuntimeActivationError::RendererProofRejected)
    }
}

fn value_after(arguments: &[String], index: usize) -> Option<String> {
    arguments.get(index + 1).filter(|value| !value.starts_with("--")).cloned()
}

fn is_valid_pipe_name(pipe_name: &str) -> bool {
    !pipe_name.is_empty() && pipe_name.len() <= 128 && pipe_name.bytes().all(|character| {
        character.is_ascii_alphanumeric() || character == b'-' || character == b'_'
    })
}
