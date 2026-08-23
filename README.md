<p align="center">
  <img src="logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>Realtime translation and transcription for VRChat.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.12.0-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
  <a href="https://github.com/awakenginexe/VRCNT/releases/latest">
    <img alt="VirusTotal status for VRCNT.exe and VRCNT-backend.exe" src="Readme/VirusTotal-status.svg" />
  </a>
</p>

<p align="center">
  <font size="4">
    🌐 <strong>Select Language / เลือกภาษา</strong><br />
    <font color="#FFFFFF"><strong>English</strong></font> |
    <a href="Readme/Readme.th.md">ภาษาไทย</a> |
    <a href="Readme/Readme.jp.md">日本語</a> |
    <a href="Readme/Readme.scn.md">简体中文</a> |
    <a href="Readme/Readme.tcn.md">繁體中文</a> |
    <a href="Readme/Readme.kr.md">한국어</a>
  </font>
</p>

## About VRCNT

VRCNT is an unofficial VRChat translation and transcription app based on the
open-source [VRCT](https://github.com/misyaguziya/VRCT) project. It is designed
for conversations where latency matters: speech should become readable
translation quickly, without a slow cloud provider freezing the rest of the
session.

## VRCNT 5.6.3 preview

<p align="center">
  <font size="4"><strong>Live</strong></font>
</p>

<p align="center">
  <img src="preview/Live.png" alt="Live" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Engine & Audio</strong></font>
</p>

<p align="center">
  <img src="preview/Engine&Audio.png" alt="Engine & Audio" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Speech Models</strong></font>
</p>

<p align="center">
  <img src="preview/SpeechModels.png" alt="Speech Models" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Translation Models</strong></font>
</p>

<p align="center">
  <img src="preview/TranslationModels.png" alt="Translation Models" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Overlay Studio</strong></font>
</p>

<p align="center">
  <img src="preview/OverlayStudio.png" alt="Overlay Studio" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Customize</strong></font>
</p>

<p align="center">
  <img src="preview/Customize.png" alt="Customize" width="960" />
</p>

## Translation quality and contributions

Translations for languages other than English are machine-generated. We are
planning improved Thai translation quality in the next build, and contributions
that improve any language are very welcome.

## Highlights

- Realtime microphone and speaker transcription.
- Multiple translation providers with automatic failover.
- A shared five-second cloud translation budget per sentence.
- Background provider cooldowns instead of blocking the live conversation.
- Optional local CTranslate2 fallback when cloud services are unavailable.
- Manual retry for an individual skipped or failed sentence.
- VR overlay, desktop overlay, clipboard, OSC, and VRChat chatbox output.
- One CUDA-enabled Windows build that can also use CPU processing.
- A focused matte-black and violet desktop interface.

## Hardware and performance

VRCNT works on CPU-only systems, but an NVIDIA GPU provides the best real-time performance.

VRCNT includes local AI runtime dependencies, which is why the application package is large. They let you use local speech and translation features without depending on a cloud service for every conversation.

- Speech models may require additional downloads after installation.
- Larger models require more RAM or VRAM, so choose a model that suits your computer.
- CPU-only mode is supported but may have higher latency, especially with larger speech models.
- Cloud engines can help weaker computers but require internet access.

## Build

Install dependencies:

```powershell
npm ci
```

Build the CUDA sidecar and Windows app:

```powershell
npm run build-cuda
```

The release executable and installer are generated under
`src-tauri/target/release`.

Official builds are published on [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases).
The installer can download its three signed multipart package files, or use
`VRCNT_<version>.7z.001` through `.003` when they are placed beside it together
with `package-manifest.json` and `package-manifest.json.sig`. To run
VRCNT portably, keep all three parts together, extract `.7z.001` with 7-Zip,
and launch `VRCNT.exe` from the extracted directory.

Downloaded models and configuration are stored under
`%LOCALAPPDATA%\VRCNTData`. VRCNT 4.1.0 automatically migrates an existing
`VRCNT-NextData` directory when the new directory does not yet exist.

## Project lineage

VRCNT is based on [VRCT](https://github.com/misyaguziya/VRCT) by misyaguziya.
The original project and this fork are distributed under the MIT License.

Report VRCNT-specific problems through the
[VRCNT issue tracker](https://github.com/awakenginexe/VRCNT/issues),
not the upstream VRCT tracker.

## License and disclaimer

See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). VRCNT is unofficial software;
it is not endorsed by VRChat. VRChat and its associated properties are
trademarks or registered trademarks of VRChat Inc.
