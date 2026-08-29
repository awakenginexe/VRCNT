# Build VRCNT 5.15.0 (Windows x64)

This repository builds one VRCNT application with two replaceable runtime
distributions. The frontend and Tauri shell are shared; only the backend and
its runtime dependencies differ between the CPU and NVIDIA CUDA payloads.

## Release architecture

- `cpu` contains the CPU-only backend and excludes CUDA-only dependencies.
- `cuda` contains the NVIDIA CUDA backend and its GPU dependencies.
- `VRCNT_5.15.0_Setup.exe` is the small public WPF bootstrapper.
- `package-manifest.json` and its `.sig` authenticate both variants. Each
  variant has its own manifest-selected number of `.7z.001`, `.002`, ... parts.
- `%LOCALAPPDATA%\VRCNTInstaller\VRCNT.Setup.exe` is the stable setup manager
  used for repairs, updates, and runtime switching. `%LOCALAPPDATA%\VRCNTData`
  remains user data and is never treated as disposable runtime payload.

The signed manifest, not a fixed part count or a filename convention, is the
source of truth for payload acquisition. The setup manager stages and backs up
runtime directories on the same volume as the target before replacement, then
requires the Tauri/backend local readiness handshake before committing.

## Prerequisites

Install the following on Windows:

1. Visual Studio Build Tools with **Desktop development with C++**, MSVC, and
   the Windows SDK.
2. Rust stable for `x86_64-pc-windows-msvc`.
3. Python **3.11**. The pinned native packages are not guaranteed to provide
   compatible wheels for newer Python releases.
4. Node.js 18 or newer.
5. NVIDIA CUDA tooling only when building the CUDA backend. End users do not
   need the CUDA SDK; they need a compatible NVIDIA driver and hardware.

## Local build

Run these commands from the repository root. They build staged artifacts under
`build/`; they do not install or launch VRCNT from `%LOCALAPPDATA%\VRCNT`.

```powershell
npm ci
npm run setup-python

# Build the shared frontend and Tauri shell.
npm run build-runtime-shell

# Build both backend payloads from their separate environments.
npm run build-backend:cpu
npm run build-backend:cuda

# Combine the shared shell with each backend and create authenticated markers.
npm run stage-runtime:cpu
npm run stage-runtime:cuda
```

The staged payloads are written to `build/release/cpu` and
`build/release/cuda`. Inspect them with
`scripts/validate_runtime_payload.ps1` before packaging. The older
`npm run build` and `npm run build-cuda` commands remain compatibility paths for
the legacy Tauri/NSIS build; they are not the public 5.15.0 release path.

## Package and verify a release

The authoritative release flow is `.github/workflows/release.yml`. For a
`vMAJOR.MINOR.PATCH` tag it:

1. builds the shared shell once;
2. builds CPU and CUDA backends in parallel;
3. stages both runtime payloads;
4. publishes `VRCNT_<version>_Setup.exe`, variable-length CPU/CUDA archives,
   the combined signed manifest, `SHA256SUMS.txt`, and signed `latest.json`;
5. verifies every manifest-selected part, the bootstrapper hash, signatures,
   portable extraction, and release asset sizes before publication.

The workflow requires `TAURI_SIGNING_PRIVATE_KEY` and the pinned, hash-checked
7-Zip/minisign inputs. Do not store signing material in the repository. A
production dry run should be performed only when Python 3.11 environments,
the pinned tools, and signing configuration are available.

## Runtime switching and migration

The application displays the active runtime in **Settings → Others → Runtime**
and requests the stable setup manager for a switch. The manager validates
`%LOCALAPPDATA%\VRCNTData\runtime.json` against the authenticated
`VRCNT.runtime.json` marker in the physical installation, preserves user data,
and keeps only the selected runtime after a successful activation. Failed or
cancelled replacement restores the previous runtime or leaves it untouched at
the last safe transaction checkpoint.

An installation from before 5.15.0 has no authoritative runtime state. During
the first 5.15.0 update, known CPU/CUDA payload boundaries are detected and
user data is migrated into `VRCNTData`; ambiguous or stale installations stop
in recovery and require an explicit runtime choice.

## Source-only verification

Use these checks for changes that do not require the native release
environments:

```powershell
python -m unittest discover -s utils/tests -p "test_*.py"
npm run test:ui
dotnet test installer-helper/tests/VRCNT.RuntimeCore.Tests/VRCNT.RuntimeCore.Tests.csproj
cargo test --manifest-path src-tauri/Cargo.toml
```

The automated suites use temporary directories and staged fixtures. They must
not be pointed at an installed VRCNT directory. For a real release, also test
fresh CPU/CUDA install, GPU-positive/negative/inconclusive selection, both
runtime switches, same-variant update, interrupted/corrupt/invalid-signature
failure, insufficient space, legacy migration, and preservation of settings,
presets, API configuration, logs, and downloaded weights.

## Troubleshooting

- If `setup-python` selects the wrong interpreter, recreate `.venv` and
  `.venv_cuda` with Python 3.11 and rerun it.
- If a backend build fails, verify the selected environment contains the
  requirements for that variant and that PyInstaller is available there.
- If packaging fails, verify that the shared shell has no backend and each
  backend directory has exactly one backend executable.
- If a manifest or hash check fails, discard the affected package and rerun the
  authenticated acquisition. Do not bypass verification or install a partial
  payload.
