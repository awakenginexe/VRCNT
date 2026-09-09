<p align="center">
  <img src="../logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>Realtime translation and transcription for VRChat.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.15.2-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
</p>

<p align="center">
  <a data-virustotal-file="VRCNT.Setup.exe" href="https://www.virustotal.com/gui/file/b51cb99014c0ddb9ff53560e7d26989dc2855b0869c2a6a7bbf778f23d97813a">
    <img alt="VirusTotal scan for VRCNT.Setup.exe" src="VirusTotal-Setup.svg" />
  </a>
  <a data-virustotal-file="VRCNT.exe" href="https://www.virustotal.com/gui/file/c93662ecae869cb98947b1309e4c3d62205c5e855c394ccc4c712df26fe1b843">
    <img alt="VirusTotal scan for VRCNT.exe" src="VirusTotal-VRCNT.svg" />
  </a>
  <a data-virustotal-file="VRCNT-backend.exe" href="https://www.virustotal.com/gui/file/1b540816a2f9b11bddfc95a43355b15acfadc0d1a45fb83e6df5501ab4c1d9cf">
    <img alt="VirusTotal scan for VRCNT-backend.exe" src="VirusTotal-backend.svg" />
  </a>
</p>

<p align="center">
  <font size="4">
    🌐 <strong>Select Language / เลือกภาษา</strong><br />
    <font color="#FFFFFF"><strong>English</strong></font> |
    <a href="Readme.th.md">ภาษาไทย</a> |
    <a href="Readme.jp.md">日本語</a> |
    <a href="Readme.scn.md">简体中文</a> |
    <a href="Readme.tcn.md">繁體中文</a> |
    <a href="Readme.kr.md">한국어</a>
  </font>
</p>

## About VRCNT

VRCNT is an unofficial VRChat translation and transcription app based on the
open-source [VRCT](https://github.com/misyaguziya/VRCT) project. It is designed
for conversations where latency matters: speech should become readable
translation quickly, without a slow cloud provider freezing the rest of the
session.

## VRCNT 5.13.0 preview

<p align="center">
  <font size="4"><strong>Live</strong></font>
</p>

<p align="center">
  <img src="../preview/Live.png" alt="Live" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Speech Recognition</strong></font>
</p>

<p align="center">
  <font size="4"><strong>Engine selector</strong></font>
</p>

<p align="center">
  <img src="../preview/Speech%20Recognition-engine.png" alt="Speech Recognition - Engine selector" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Model selector</strong></font>
</p>

<p align="center">
  <img src="../preview/Speech%20Recognition-model.png" alt="Speech Recognition - Model selector" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Translator Option</strong></font>
</p>

<p align="center">
  <img src="../preview/Translator%20Option.png" alt="Translator Option" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Overlay Studio</strong></font>
</p>

<p align="center">
  <font size="4"><strong>Desktop</strong></font>
</p>

<p align="center">
  <img src="../preview/Overlay%20Studio-Desktop.png" alt="Overlay Studio - Desktop" width="960" />
</p>

<p align="center">
  <font size="4"><strong>VR</strong></font>
</p>

<p align="center">
  <img src="../preview/Overlay%20Studio-VR.png" alt="Overlay Studio - VR" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Customize</strong></font>
</p>

<p align="center">
  <font size="4"><strong>UI Color</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize-Color.png" alt="Customize - UI Color" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Background</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize-BG.png" alt="Customize - Background" width="960" />
</p>

<p align="center">
  <font size="4"><strong>Settings (VRCT)</strong></font>
</p>

<p align="center">
  <img src="../preview/Settings.png" alt="Settings (VRCT)" width="960" />
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
- Separate CPU-only and NVIDIA CUDA Windows runtimes distributed from one installer.
- A focused matte-black and violet desktop interface.

## Hardware and performance

VRCNT offers a smaller CPU-only runtime and a separate NVIDIA CUDA runtime. An
NVIDIA GPU provides the best real-time performance, but CPU remains available
on every supported Windows system.

VRCNT includes local AI runtime dependencies, which is why the application package is large. They let you use local speech and translation features without depending on a cloud service for every conversation.

- Speech models may require additional downloads after installation.
- Larger models require more RAM or VRAM, so choose a model that suits your computer.
- CPU-only installs avoid CUDA-specific runtime libraries and use less download and disk space.
- The active runtime can be changed later from **Settings → Others → Runtime**. Switching is a staged, verified runtime replacement and preserves user data.
- Cloud engines can help weaker computers but require internet access.

## Build

Install dependencies and build the shared shell:

```powershell
npm ci
npm run setup-python
npm run build-runtime-shell
```

Build and stage both runtime variants:

```powershell
npm run build-backend:cpu
npm run build-backend:cuda
npm run stage-runtime:cpu
npm run stage-runtime:cuda
```

The staged payloads are generated under `build/release/cpu` and
`build/release/cuda`. The public release workflow builds the small WPF
bootstrapper `VRCNT_5.15.2_Setup.exe` and publishes both payloads.

Official builds are published on [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases).
The installer detects compatible NVIDIA hardware, recommends CUDA when positive
detection succeeds, and still allows a deliberate CPU choice. The signed
manifest selects the exact number of CPU or CUDA archive parts; the variants do
not need the same number of parts. For portable use, keep the selected parts
together, verify the signed manifest, extract `.7z.001` with 7-Zip, and launch
`VRCNT.exe` from the extracted directory.

Downloaded models and configuration are stored under
`%LOCALAPPDATA%\VRCNTData`. The stable setup manager is maintained at
`%LOCALAPPDATA%\VRCNTInstaller\VRCNT.Setup.exe` and preserves this user-data
root during installation, updates, and runtime switching. Ambiguous or stale
pre-5.15.0 installations enter recovery instead of being deleted blindly.

## Project lineage

VRCNT is based on [VRCT](https://github.com/misyaguziya/VRCT) by misyaguziya.
The original project and this fork are distributed under the MIT License.

Report VRCNT-specific problems through the
[VRCNT issue tracker](https://github.com/awakenginexe/VRCNT/issues),
not the upstream VRCT tracker.

## License and disclaimer

See [LICENSE](../LICENSE) and [NOTICE.md](../NOTICE.md). VRCNT is unofficial software;
it is not endorsed by VRChat. VRChat and its associated properties are
trademarks or registered trademarks of VRChat Inc.
