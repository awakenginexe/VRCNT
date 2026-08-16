<p align="center">
  <img src="../logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>專為 VRChat 打造的即時翻譯與語音轉文字工具</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.6.3-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
</p>

<p align="center">
  <font size="4">
    🌐 <strong>Select Language / 選擇語言</strong><br />
    <a href="Readme.en.md">English</a> |
    <a href="Readme.th.md">ภาษาไทย</a> |
    <a href="Readme.jp.md">日本語</a> |
    <a href="Readme.scn.md">简体中文</a> |
    <font color="#FFFFFF"><strong>繁體中文</strong></font> |
    <a href="Readme.kr.md">한국어</a>
  </font>
</p>

> [!NOTE]
> **注意:** 本文檔由 AI 翻譯，部分詞彙或表達可能不夠準確。

## 關於 VRCNT

VRCNT 是一款非官方的 VRChat 翻譯與語音轉文字應用，基於開源專案 [VRCT](https://github.com/misyaguziya/VRCT) 開發。它專為對延遲敏感的對話場景設計：語音可被快速轉譯為易讀的翻譯，不會因雲端服務商的卡頓而影響整體對話流程。

## VRCNT 5.6.3 預覽

<p align="center">
  <font size="4"><strong>即時</strong></font>
</p>

<p align="center">
  <img src="../preview/Live.png" alt="即時" width="960" />
</p>

<p align="center">
  <font size="4"><strong>引擎與音效</strong></font>
</p>

<p align="center">
  <img src="../preview/Engine&Audio.png" alt="引擎與音效" width="960" />
</p>

<p align="center">
  <font size="4"><strong>語音模型</strong></font>
</p>

<p align="center">
  <img src="../preview/SpeechModels.png" alt="語音模型" width="960" />
</p>

<p align="center">
  <font size="4"><strong>翻譯模型</strong></font>
</p>

<p align="center">
  <img src="../preview/TranslationModels.png" alt="翻譯模型" width="960" />
</p>

<p align="center">
  <font size="4"><strong>覆蓋層工作室</strong></font>
</p>

<p align="center">
  <img src="../preview/OverlayStudio.png" alt="覆蓋層工作室" width="960" />
</p>

<p align="center">
  <font size="4"><strong>自訂</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize.png" alt="自訂" width="960" />
</p>

## 翻譯品質與貢獻

除英語外的其他語言翻譯均為自動生成。我們計劃在下一個版本中提高泰語翻譯品質，非常歡迎大家為改進任何語言的翻譯做出貢獻。

## 功能亮點

- 麥克風與揚聲器的即時語音轉文字。
- 支援多個翻譯服務商並具備自動故障轉移（Automatic Failover）功能。
- 每句話享有 5 秒的共享雲端翻譯時間預算。
- 後台服務商冷卻機制，不會阻塞即時對話。
- 當雲端服務不可用時，可自動回退至本地 CTranslate2。
- 支援對被跳過或失敗的單句進行手動重試（Manual Retry）。
- 支援輸出至 VR 懸浮窗、桌面懸浮窗、剪貼簿、OSC 及 VRChat 聊天框。
- 單一的 CUDA Windows 建置版本，同時支援切換至 CPU 處理。
- 專注於使用體驗的啞光黑與紫羅蘭配色桌面介面。

## 硬體與效能

VRCNT 可以在純 CPU 系統上執行，但使用 NVIDIA GPU 能夠獲得最佳的即時效能。

VRCNT 包含了本地 AI 執行階段依賴，因此應用安裝套件體積較大。這使使用者能在不依賴雲端服務的情況下使用本地語音與翻譯功能。

- 語音模型在安裝後可能需要額外下載。
- 較大的模型需要消耗更多的記憶體（RAM）或顯示記憶體（VRAM），請根據您的電腦設定選擇合適的模型。
- 支援純 CPU 模式，但在使用較大語音模型時延遲可能較高。
- 雲端引擎可以減輕效能較低電腦的負擔，但需要連接網際網路。

## 建置 (Build)

安裝相依套件：

```powershell
npm ci
```

建置 CUDA Sidecar 及 Windows 應用：

```powershell
npm run build-cuda
```

生成的發布可執行檔及安裝套件位於
`src-tauri/target/release`。

官方建置版本發布於 [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases)。
安裝套件可以自動下載其 3 個已簽署的多分割套件檔案，或者當
`VRCNT_<version>.7z.001` 至 `.003` 與 `package-manifest.json` 及 `package-manifest.json.sig`
放置在同一目錄下時直接使用。如需可攜執行 VRCNT，請保持這 3 個分割套件在同一目錄下，使用 7-Zip 解壓縮 `.7z.001`，並從解壓縮後的目錄中執行 `VRCNT.exe`。

下載的模型和設定檔保存在
`%LOCALAPPDATA%\VRCNTData`。如果新目錄尚未存在，VRCNT 4.1.0 將自動遷移現有的 `VRCNT-NextData` 目錄。

## 專案淵源

VRCNT 基於 misyaguziya 開發的 [VRCT](https://github.com/misyaguziya/VRCT)。
原專案與本衍生專案均基於 MIT 許可證分發。

若遇到 VRCNT 特有的問題，請透過
[VRCNT Issue Tracker](https://github.com/awakenginexe/VRCNT/issues)
反饋，而非上游的 VRCT 追蹤器。

## 許可證與免責聲明

請參閱 [LICENSE](../LICENSE) 與 [NOTICE.md](../NOTICE.md)。VRCNT 為非官方軟體，未經 VRChat 官方認可或贊助。VRChat 及其相關資產均為 VRChat Inc. 的商標或註冊商標。
