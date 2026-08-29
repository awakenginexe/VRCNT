<p align="center">
  <img src="../logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>VRChat向けのリアルタイム翻訳＆音声文字起こしツール</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.15.0-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
</p>

<p align="center">
  <a data-virustotal-file="VRCNT.exe" href="https://www.virustotal.com/gui/file/d0fdb2ad78e3262500a0e0632b6d29001618ff7c92984f03a676756f40d2f1f8">
    <img alt="VirusTotal における VRCNT.exe のスキャン結果" src="VirusTotal-VRCNT.svg" />
  </a>
  <a data-virustotal-file="VRCNT-backend.exe" href="https://www.virustotal.com/gui/file/4f0ab4b2daf84dfe59e95821bc548754639b517c88eb46f1a1c6202dc36fbb75">
    <img alt="VirusTotal における VRCNT-backend.exe のスキャン結果" src="VirusTotal-backend.svg" />
  </a>
</p>

<p align="center">
  <font size="4">
    🌐 <strong>Select Language / 言語を選択</strong><br />
    <a href="Readme.en.md">English</a> |
    <a href="Readme.th.md">ภาษาไทย</a> |
    <font color="#FFFFFF"><strong>日本語</strong></font> |
    <a href="Readme.scn.md">简体中文</a> |
    <a href="Readme.tcn.md">繁體中文</a> |
    <a href="Readme.kr.md">한국어</a>
  </font>
</p>

> [!NOTE]
> **ご注意:** 本ドキュメントはAIによって翻訳されています。一部の表現や用語が正確でない場合があります。

## VRCNTについて

VRCNTは、オープンソースプロジェクト [VRCT](https://github.com/misyaguziya/VRCT) をベースとした非公式のVRChat向け翻訳・文字起こしアプリです。レイテンシ（遅延）が重視される会話のために設計されており、クラウドプロバイダーの遅延によってセッションが停止することなく、話した音声が迅速かつ読みやすい翻訳として表示されます。

## VRCNT 5.13.0 プレビュー

<p align="center">
  <font size="4"><strong>ライブ</strong></font>
</p>

<p align="center">
  <img src="../preview/Live.png" alt="ライブ" width="960" />
</p>

<p align="center">
  <font size="4"><strong>音声認識</strong></font>
</p>

<p align="center">
  <font size="4"><strong>エンジン選択</strong></font>
</p>

<p align="center">
  <img src="../preview/Speech%20Recognition-engine.png" alt="音声認識 - エンジン選択" width="960" />
</p>

<p align="center">
  <font size="4"><strong>モデル選択</strong></font>
</p>

<p align="center">
  <img src="../preview/Speech%20Recognition-model.png" alt="音声認識 - モデル選択" width="960" />
</p>

<p align="center">
  <font size="4"><strong>翻訳オプション</strong></font>
</p>

<p align="center">
  <img src="../preview/Translator%20Option.png" alt="翻訳オプション" width="960" />
</p>

<p align="center">
  <font size="4"><strong>オーバーレイスタジオ</strong></font>
</p>

<p align="center">
  <font size="4"><strong>デスクトップ</strong></font>
</p>

<p align="center">
  <img src="../preview/Overlay%20Studio-Desktop.png" alt="オーバーレイスタジオ - デスクトップ" width="960" />
</p>

<p align="center">
  <font size="4"><strong>VR</strong></font>
</p>

<p align="center">
  <img src="../preview/Overlay%20Studio-VR.png" alt="オーバーレイスタジオ - VR" width="960" />
</p>

<p align="center">
  <font size="4"><strong>カスタマイズ</strong></font>
</p>

<p align="center">
  <font size="4"><strong>UIカラー</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize-Color.png" alt="カスタマイズ - UIカラー" width="960" />
</p>

<p align="center">
  <font size="4"><strong>背景</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize-BG.png" alt="カスタマイズ - 背景" width="960" />
</p>

<p align="center">
  <font size="4"><strong>設定 (VRCT)</strong></font>
</p>

<p align="center">
  <img src="../preview/Settings.png" alt="設定 (VRCT)" width="960" />
</p>

## 翻訳の品質と貢献

英語以外の言語の翻訳は機械生成されています。次回のビルドではタイ語翻訳の品質向上を予定しており、あらゆる言語の改善に対する貢献（Contribution）を歓迎します。

## 主な特徴

- マイクおよびスピーカーからのリアルタイム文字起こし
- 自動フェイルオーバー機能を備えた複数の翻訳プロバイダーサポート
- 1文あたり最大5秒の共有クラウド翻訳バジェット
- ライブ会話をブロックしないバックグラウンドでのプロバイダークールダウン
- クラウドサービスが利用できない場合のローカル CTranslate2 フォールバック機能
- スキップまたは失敗した文の個別の手動再試行（Manual Retry）
- VRオーバーレイ、デスクトップオーバーレイ、クリップボード、OSC、VRChatチャットボックスへの出力
- 1つのインストーラーから選択できるCPU専用ランタイムとNVIDIA CUDAランタイム
- マットブラックとバイオレットを基調とした洗練されたデスクトップUI

## ハードウェアとパフォーマンス

VRCNTはCPUのみのシステムでも動作しますが、NVIDIA GPUを使用することで最高のリアルタイムパフォーマンスを発揮します。

VRCNTにはローカルAIランタイム依存関係が含まれているため、アプリケーションパッケージのサイズが大きくなっています。これにより、すべての会話でクラウドサービスに依存することなく、ローカルでの音声処理や翻訳機能を利用できます。

- 文字起こしモデルはインストール後に追加のダウンロードが必要な場合があります。
- 大型モデルはより多くのRAMまたはVRAMを消費するため、お使いのPCに適したモデルを選択してください。
- CPU専用インストールではCUDA固有のランタイムを含めないため、ダウンロード容量とディスク使用量を抑えられます。
- 使用中のランタイムは **Settings → Others → Runtime** から後で切り替えられます。切り替えはユーザーデータを保持する検証済みの入れ替え処理です。
- クラウドエンジンは低スペックのPCを補うことができますが、インターネット接続が必要です。

## ビルド (Build)

依存関係をインストールします:

```powershell
npm ci
```

共有シェルと両方のランタイムをビルドします:

```powershell
npm run setup-python
npm run build-runtime-shell
npm run build-backend:cpu
npm run build-backend:cuda
npm run stage-runtime:cpu
npm run stage-runtime:cuda
```

ステージ済みのペイロードは `build/release/cpu` と `build/release/cuda` に生成されます。公開リリースでは小容量のWPFブートストラッパー `VRCNT_5.15.0_Setup.exe` と両方のペイロードを使用します。

公式ビルドは [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases) で公開されています。
インストーラーは互換性のあるNVIDIA GPUを検出し、CUDAを推奨します。署名済みマニフェストがCPUまたはCUDAのパーツ数を決定するため、両バリアントのパーツ数は同じである必要はありません。ポータブル実行では、選択したパーツと署名済みマニフェストを同じフォルダに置き、`.7z.001` を7-Zipで解凍して `VRCNT.exe` を起動してください。

ダウンロードしたモデルと設定は `%LOCALAPPDATA%\VRCNTData` に保存されます。安定セットアップマネージャーは `%LOCALAPPDATA%\VRCNTInstaller\VRCNT.Setup.exe` にあり、ランタイムの更新や切り替えでもユーザーデータを保持します。

## プロジェクトの系譜

VRCNTは misyaguziya 氏による [VRCT](https://github.com/misyaguziya/VRCT) に基づいています。
オリジナルプロジェクトおよび本フォークはMITライセンスの下で配布されています。

VRCNT固有の問題については、本家のVRCTトラッカーではなく
[VRCNT Issue Tracker](https://github.com/awakenginexe/VRCNT/issues)
へ報告してください。

## ライセンスと免責事項

[LICENSE](../LICENSE) および [NOTICE.md](../NOTICE.md) をご参照ください。VRCNTは非公式のソフトウェアであり、VRChat Inc. によって承認されたものではありません。VRChatおよび関連するプロパティは、VRChat Inc. の商標または登録商標です。
