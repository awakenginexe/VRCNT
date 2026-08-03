<p align="center">
  <img src="../logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>VRChat向けのリアルタイム翻訳＆音声文字起こしツール</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.0.0-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
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

## VRCNT 5.0.0 プレビュー

<p align="center">
  <img src="../preview/Preview.png" alt="VRCNT 5.0.0 アプリケーションプレビュー" width="960" />
</p>

## VRCNT 5.0.0 の新機能

- UX/UIの改善
- 発話（Speaking）と聴取（Listening）で別々の文字起こしモデルを選択可能
- DeepSeek API 翻訳のサポート（実験的機能。動作を保証するものではありません）
- アプリ内通知およびデスクトップオーバーレイの動作修正
- デスクトップおよびVRオーバーレイのカスタマイズ機能
- 新しいガイド付きセットアップ（Guided Setup）
- 新しい「Engines & Audio」モデル設定（従来のModel & Provider設定も引き続き使用可能）
- サポートされている全言語での機械翻訳のサポート

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
- CPU処理にも切り替え可能な1つのCUDA対応Windowsビルド
- マットブラックとバイオレットを基調とした洗練されたデスクトップUI

## ハードウェアとパフォーマンス

VRCNTはCPUのみのシステムでも動作しますが、NVIDIA GPUを使用することで最高のリアルタイムパフォーマンスを発揮します。

VRCNTにはローカルAIランタイム依存関係が含まれているため、アプリケーションパッケージのサイズが大きくなっています。これにより、すべての会話でクラウドサービスに依存することなく、ローカルでの音声処理や翻訳機能を利用できます。

- 文字起こしモデルはインストール後に追加のダウンロードが必要な場合があります。
- 大型モデルはより多くのRAMまたはVRAMを消費するため、お使いのPCに適したモデルを選択してください。
- CPU専用モードもサポートされていますが、特に大型の音声モデルではレイテンシが高くなる場合があります。
- クラウドエンジンは低スペックのPCを補うことができますが、インターネット接続が必要です。

## ビルド (Build)

依存関係をインストールします:

```powershell
npm ci
```

CUDAサイドカーとWindowsアプリをビルドします:

```powershell
npm run build-cuda
```

リリース実行ファイルおよびインストーラーは `src-tauri/target/release` 以下に生成されます。

公式ビルドは [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases) で公開されています。
インストーラーは、署名された3つの分割パッケージファイルをダウンロードするか、
`package-manifest.json` および `package-manifest.json.sig` と一緒に
`VRCNT_<version>.7z.001` から `.003` を同じディレクトリに配置して使用できます。
VRCNTをポータブルで実行する場合は、3つのパーツをすべて同じフォルダに保持し、7-Zipで `.7z.001` を解凍して、解凍先フォルダから `VRCNT.exe` を起動してください。

ダウンロードしたモデルと設定は `%LOCALAPPDATA%\VRCNTData` に保存されます。VRCNT 4.1.0 は、新しいディレクトリがまだ存在しない場合、既存の `VRCNT-NextData` ディレクトリを自動的に移行します。

## プロジェクトの系譜

VRCNTは misyaguziya 氏による [VRCT](https://github.com/misyaguziya/VRCT) に基づいています。
オリジナルプロジェクトおよび本フォークはMITライセンスの下で配布されています。

VRCNT固有の問題については、本家のVRCTトラッカーではなく
[VRCNT Issue Tracker](https://github.com/awakenginexe/VRCNT/issues)
へ報告してください。

## ライセンスと免責事項

[LICENSE](../LICENSE) および [NOTICE.md](../NOTICE.md) をご参照ください。VRCNTは非公式のソフトウェアであり、VRChat Inc. によって承認されたものではありません。VRChatおよび関連するプロパティは、VRChat Inc. の商標または登録商標です。
