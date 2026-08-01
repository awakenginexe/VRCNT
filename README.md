<p align="center">
  <img src="logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>Realtime translation and transcription for VRChat.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-4.2.3-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
</p>

## About VRCNT

VRCNT is an unofficial VRChat translation and transcription app based on the
open-source [VRCT](https://github.com/misyaguziya/VRCT) project. It is designed
for conversations where latency matters: speech should become readable
translation quickly, without a slow cloud provider freezing the rest of the
session.

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

## Preview

The current preview images are retained for now and will be refreshed for the
new VRCNT interface later.

<table align="center">
  <tr>
    <td align="center">
      <strong>Sakura Pink</strong><br />
      <img src="preview/SakuraPink.png" alt="Sakura Pink normal mode preview" width="320" />
    </td>
    <td align="center">
      <strong>Sakura Pink Performance</strong><br />
      <img src="preview/SakuraPink%20Perf.png" alt="Sakura Pink performance mode preview" width="320" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Neon Cyan</strong><br />
      <img src="preview/NeonCyan.png" alt="Neon Cyan normal mode preview" width="320" />
    </td>
    <td align="center">
      <strong>Neon Cyan Performance</strong><br />
      <img src="preview/NeonCyan%20Perf.png" alt="Neon Cyan performance mode preview" width="320" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Midnight Purple</strong><br />
      <img src="preview/MidnightPurple.png" alt="Midnight Purple normal mode preview" width="320" />
    </td>
    <td align="center">
      <strong>Midnight Purple Performance</strong><br />
      <img src="preview/MidnightPurple%20Perf.png" alt="Midnight Purple performance mode preview" width="320" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Emerald Green</strong><br />
      <img src="preview/EmeraldGreen.png" alt="Emerald Green normal mode preview" width="320" />
    </td>
    <td align="center">
      <strong>Emerald Green Performance</strong><br />
      <img src="preview/EmeraldGreen%20Perf.png" alt="Emerald Green performance mode preview" width="320" />
    </td>
  </tr>
</table>

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
