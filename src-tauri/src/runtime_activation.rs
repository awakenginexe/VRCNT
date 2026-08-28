use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const RUNTIME_ACTIVATION_PIPE_ARGUMENT: &str = "--runtime-activation-pipe";
pub const RUNTIME_ACTIVATION_TOKEN_ARGUMENT: &str = "--runtime-activation-token";
pub const RUNTIME_ACTIVATION_PROTOCOL_VERSION: u8 = 1;

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActivationFrontendContext {
    pub activation_token: String,
    pub nonce: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RuntimeActivationMessage {
    pub protocol_version: u8,
    pub status: &'static str,
    pub token: String,
    pub nonce: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeActivationError {
    MissingArguments,
    InvalidPipeName,
    TokenMismatch,
    NonceMismatch,
    AlreadyCompleted,
    BackendNotReady,
    PipeWriteFailed,
}

impl std::fmt::Display for RuntimeActivationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for RuntimeActivationError {}

#[derive(Debug)]
struct RuntimeActivationBinding {
    pipe_name: String,
    token: String,
    nonce: String,
}

#[derive(Debug)]
pub struct RuntimeActivationContext {
    binding: Option<RuntimeActivationBinding>,
    completed: Mutex<bool>,
}

impl RuntimeActivationContext {
    pub fn from_launch_args<I, S>(args: I) -> Result<Option<Self>, RuntimeActivationError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut pipe_name = None;
        let mut token = None;
        let arguments: Vec<String> = args
            .into_iter()
            .map(|argument| argument.as_ref().to_owned())
            .collect();
        let mut index = 0;
        while index < arguments.len() {
            match arguments[index].as_str() {
                RUNTIME_ACTIVATION_PIPE_ARGUMENT => {
                    pipe_name = arguments.get(index + 1).cloned();
                    index += 1;
                }
                RUNTIME_ACTIVATION_TOKEN_ARGUMENT => {
                    token = arguments.get(index + 1).cloned();
                    index += 1;
                }
                _ => {}
            }
            index += 1;
        }

        let (Some(pipe_name), Some(token)) = (pipe_name, token) else {
            return if arguments.iter().any(|argument| {
                argument == RUNTIME_ACTIVATION_PIPE_ARGUMENT
                    || argument == RUNTIME_ACTIVATION_TOKEN_ARGUMENT
            }) {
                Err(RuntimeActivationError::MissingArguments)
            } else {
                Ok(None)
            };
        };
        if !is_valid_pipe_name(&pipe_name) {
            return Err(RuntimeActivationError::InvalidPipeName);
        }
        if token.trim().is_empty() {
            return Err(RuntimeActivationError::MissingArguments);
        }

        Ok(Some(Self {
            binding: Some(RuntimeActivationBinding {
                nonce: generate_nonce(&pipe_name, &token),
                pipe_name,
                token,
            }),
            completed: Mutex::new(false),
        }))
    }

    pub fn inactive() -> Self {
        Self {
            binding: None,
            completed: Mutex::new(false),
        }
    }

    pub fn frontend_context(&self) -> Option<RuntimeActivationFrontendContext> {
        self.binding
            .as_ref()
            .map(|binding| RuntimeActivationFrontendContext {
                activation_token: binding.token.clone(),
                nonce: binding.nonce.clone(),
            })
    }

    pub fn signal_ready(&self, backend_ready: bool) -> Result<bool, RuntimeActivationError> {
        if !backend_ready {
            return Err(RuntimeActivationError::BackendNotReady);
        }
        let Some(binding) = self.binding.as_ref() else {
            return Ok(false);
        };
        self.complete_if_matches(&binding.token, &binding.nonce, |message| {
            write_named_pipe(&binding.pipe_name, &message)
        })?;
        Ok(true)
    }

    pub fn complete_if_matches<F>(
        &self,
        token: &str,
        nonce: &str,
        deliver: F,
    ) -> Result<(), RuntimeActivationError>
    where
        F: FnOnce(RuntimeActivationMessage) -> Result<(), RuntimeActivationError>,
    {
        let Some(binding) = self.binding.as_ref() else {
            return Err(RuntimeActivationError::MissingArguments);
        };
        if token != binding.token {
            return Err(RuntimeActivationError::TokenMismatch);
        }
        if nonce != binding.nonce {
            return Err(RuntimeActivationError::NonceMismatch);
        }

        let mut completed = self
            .completed
            .lock()
            .map_err(|_| RuntimeActivationError::AlreadyCompleted)?;
        if *completed {
            return Err(RuntimeActivationError::AlreadyCompleted);
        }
        deliver(RuntimeActivationMessage {
            protocol_version: RUNTIME_ACTIVATION_PROTOCOL_VERSION,
            status: "ready",
            token: binding.token.clone(),
            nonce: binding.nonce.clone(),
        })?;
        *completed = true;
        Ok(())
    }
}

fn is_valid_pipe_name(pipe_name: &str) -> bool {
    !pipe_name.is_empty()
        && pipe_name.len() <= 128
        && pipe_name.bytes().all(|character| {
            character.is_ascii_alphanumeric() || character == b'-' || character == b'_'
        })
}

fn generate_nonce(pipe_name: &str, token: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = NONCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(pipe_name.as_bytes());
    hasher.update(token.as_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(now.to_le_bytes());
    hasher.update(counter.to_le_bytes());
    let mut nonce = String::with_capacity(64);
    for byte in hasher.finalize() {
        let _ = write!(nonce, "{byte:02x}");
    }
    nonce
}

fn write_named_pipe(
    pipe_name: &str,
    message: &RuntimeActivationMessage,
) -> Result<(), RuntimeActivationError> {
    let path = named_pipe_path(pipe_name);
    let serialized =
        serde_json::to_vec(message).map_err(|_| RuntimeActivationError::PipeWriteFailed)?;
    let mut pipe = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|_| RuntimeActivationError::PipeWriteFailed)?;
    pipe.write_all(&serialized)
        .and_then(|_| pipe.write_all(b"\n"))
        .map_err(|_| RuntimeActivationError::PipeWriteFailed)
}

fn named_pipe_path(pipe_name: &str) -> PathBuf {
    PathBuf::from(format!(r"\\.\pipe\{pipe_name}"))
}
