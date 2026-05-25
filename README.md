<p align="center">
  <img src="logo/VRCNT%20FULL-transparent.png" alt="VRCNT" width="520" />
</p>

<p align="center">
  <strong>A cleaner VRChat translation and transcription app, based on VRCT.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-2.2.0-20d6ff?style=for-the-badge&labelColor=071018" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-7c4dff?style=for-the-badge&labelColor=071018" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-35e0c2?style=for-the-badge&labelColor=071018" />
</p>

## What is VRCNT?

VRCNT is an unofficial VRChat translation and transcription tool. It is built from the open-source [VRCT](https://github.com/misyaguziya/VRCT) codebase and shaped into a simpler, cleaner VRCNT experience.

The goal is practical: make multilingual VRChat sessions easier with local AI models, readable language controls, VR overlay support, and a modern interface without extra features that do not belong in the app.

## Highlights

- Translate messages for VRChat chatbox workflows.
- Transcribe microphone and speaker audio.
- Use one Windows release package with CUDA support included.
- Fall back to CPU processing when a supported NVIDIA GPU is not available.
- Install signed in-app updates without deleting downloaded models.
- Show clearer country flags and language selectors.
- Display translation logs in a VR overlay.
- Keep the UI focused by removing the plugin system.

## Download

This repository is prepared for a single VRCNT Windows release package:

- Portable package: `VRCNT.zip`
- Windows installer: `VRCNT_2.2.0_x64-setup.exe`

VRCNT ships CUDA support in the main package. Users without a supported NVIDIA GPU can still run the app with CPU processing from the same download.

Downloaded models are stored in `%LOCALAPPDATA%\VRCNTData\weights` so app updates and reinstalls do not remove them.

For development builds, the generated app is written to:

```text
src-tauri/target/release/VRCNT.exe
```

## Build

Install dependencies first:

```powershell
npm install
```

Build the release version:

```powershell
npm run build-cuda
```

Create the portable release package:

```powershell
npm run release
```

## Project Lineage

VRCNT is based on [VRCT](https://github.com/misyaguziya/VRCT) by misyaguziya.

The original VRCT project is MIT licensed. VRCNT keeps the original copyright notice and license text, and adds VRCNT attribution for the modified fork.

## Issues

Please report VRCNT bugs in [awakenginexe/VRCNT Issues](https://github.com/awakenginexe/VRCNT/issues). Do not report VRCNT-specific crashes to the upstream VRCT issue tracker.

## License

This project is released under the MIT License. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

## Disclaimer

VRCNT is unofficial software. It is not endorsed by VRChat and does not reflect the views or opinions of VRChat or anyone officially involved in producing or managing VRChat properties. VRChat and all associated properties are trademarks or registered trademarks of VRChat Inc.
