<p align="center">
  <img src="../logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>VRChat을 위한 실시간 번역 및 음성 텍스트 변환(STT) 도구</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.15.0-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
</p>

<p align="center">
  <a data-virustotal-file="VRCNT.exe" href="https://www.virustotal.com/gui/file/d0fdb2ad78e3262500a0e0632b6d29001618ff7c92984f03a676756f40d2f1f8">
    <img alt="VRCNT.exe VirusTotal 검사 결과" src="VirusTotal-VRCNT.svg" />
  </a>
  <a data-virustotal-file="VRCNT-backend.exe" href="https://www.virustotal.com/gui/file/4f0ab4b2daf84dfe59e95821bc548754639b517c88eb46f1a1c6202dc36fbb75">
    <img alt="VRCNT-backend.exe VirusTotal 검사 결과" src="VirusTotal-backend.svg" />
  </a>
</p>

<p align="center">
  <font size="4">
    🌐 <strong>Select Language / 언어 선택</strong><br />
    <a href="Readme.en.md">English</a> |
    <a href="Readme.th.md">ภาษาไทย</a> |
    <a href="Readme.jp.md">日本語</a> |
    <a href="Readme.scn.md">简体中文</a> |
    <a href="Readme.tcn.md">繁體中文</a> |
    <font color="#FFFFFF"><strong>한국어</strong></font>
  </font>
</p>

> [!NOTE]
> **참고:** 이 문서는 AI를 통해 번역되었습니다. 일부 단어나 표현이 정확하지 않을 수 있습니다.

## VRCNT 소개

VRCNT는 오픈소스 프로젝트인 [VRCT](https://github.com/misyaguziya/VRCT)를 기반으로 제작된 비공식 VRChat 번역 및 음성 텍스트 변환 애플리케이션입니다. 반응 속도(지연 시간)가 중요한 대화를 위해 설계되었으며, 클라우드 서비스의 지연으로 대화 흐름이 멈추지 않고 빠른 실시간 번역을 제공합니다.

## VRCNT 5.13.0 미리보기

<p align="center">
  <font size="4"><strong>라이브</strong></font>
</p>

<p align="center">
  <img src="../preview/Live.png" alt="라이브" width="960" />
</p>

<p align="center">
  <font size="4"><strong>음성 인식</strong></font>
</p>

<p align="center">
  <font size="4"><strong>엔진 선택</strong></font>
</p>

<p align="center">
  <img src="../preview/Speech%20Recognition-engine.png" alt="음성 인식 - 엔진 선택" width="960" />
</p>

<p align="center">
  <font size="4"><strong>모델 선택</strong></font>
</p>

<p align="center">
  <img src="../preview/Speech%20Recognition-model.png" alt="음성 인식 - 모델 선택" width="960" />
</p>

<p align="center">
  <font size="4"><strong>번역 옵션</strong></font>
</p>

<p align="center">
  <img src="../preview/Translator%20Option.png" alt="번역 옵션" width="960" />
</p>

<p align="center">
  <font size="4"><strong>오버레이 스튜디오</strong></font>
</p>

<p align="center">
  <font size="4"><strong>데스크톱</strong></font>
</p>

<p align="center">
  <img src="../preview/Overlay%20Studio-Desktop.png" alt="오버레이 스튜디오 - 데스크톱" width="960" />
</p>

<p align="center">
  <font size="4"><strong>VR</strong></font>
</p>

<p align="center">
  <img src="../preview/Overlay%20Studio-VR.png" alt="오버레이 스튜디오 - VR" width="960" />
</p>

<p align="center">
  <font size="4"><strong>사용자 지정</strong></font>
</p>

<p align="center">
  <font size="4"><strong>UI 색상</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize-Color.png" alt="사용자 지정 - UI 색상" width="960" />
</p>

<p align="center">
  <font size="4"><strong>배경</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize-BG.png" alt="사용자 지정 - 배경" width="960" />
</p>

<p align="center">
  <font size="4"><strong>설정 (VRCT)</strong></font>
</p>

<p align="center">
  <img src="../preview/Settings.png" alt="설정 (VRCT)" width="960" />
</p>

## 번역 품질 및 기여

영어 이외의 언어 번역은 기계 번역으로 생성되었습니다. 다음 빌드에서는 태국어 번역 품질 향상을 계획하고 있으며, 모든 언어의 번역 품질 개선에 대한 기여(Contribution)를 환영합니다.

## 주요 특징

- 마이크 및 스피커 음성의 실시간 텍스트 변환.
- 자동 장애 조치(Failover) 기능을 포함한 여러 번역 제공자(Provider) 지원.
- 문장당 최대 5초의 공유 클라우드 번역 시간 할당량.
- 대화를 방해하지 않는 백그라운드 공급자 쿨다운 시스템.
- 클라우드 서비스를 사용할 수 없을 때 로컬 CTranslate2 자동 대체(Fallback).
- 건너뛰었거나 실패한 개별 문장에 대한 수동 재시도(Manual Retry).
- VR 오버레이, 데스크톱 오버레이, 클립보드, OSC 및 VRChat 챗박스로 출력 지원.
- 하나의 설치 프로그램에서 선택할 수 있는 CPU 전용 및 NVIDIA CUDA Windows 런타임.
- 매트 블랙과 바이올렛 컬러로 구성된 집중력 높은 데스크톱 인터페이스.

## 하드웨어 및 성능

VRCNT는 CPU 전용 시스템에서도 작동하지만, NVIDIA GPU를 사용할 때 가장 뛰어난 실시간 성능을 발휘합니다.

VRCNT에는 로컬 AI 런타임 종속성이 포함되어 있어 애플리케이션 패키지 용량이 큽니다. 이를 통해 모든 대화에서 클라우드 서비스에 의존하지 않고 로컬 음성 처리 및 번역 기능을 사용할 수 있습니다.

- 음성 모델은 설치 후 추가 다운로드가 필요할 수 있습니다.
- 대형 모델일수록 더 많은 RAM 또는 VRAM이 필요하므로 사용자의 PC 사양에 맞는 모델을 선택하세요.
- CPU 전용 설치는 CUDA 전용 런타임을 포함하지 않아 다운로드 및 디스크 사용량이 더 적습니다.
- 현재 런타임은 **Settings → Others → Runtime**에서 변경할 수 있으며, 사용자 데이터는 보존됩니다.
- 클라우드 엔진을 사용하면 저사양 PC의 부담을 줄일 수 있지만 인터넷 연결이 필요합니다.

## 빌드 (Build)

종속성 설치:

```powershell
npm ci
```

공유 셸과 두 런타임 빌드:

```powershell
npm run setup-python
npm run build-runtime-shell
npm run build-backend:cpu
npm run build-backend:cuda
npm run stage-runtime:cpu
npm run stage-runtime:cuda
```

스테이징된 페이로드는 `build/release/cpu` 및 `build/release/cuda`에 생성됩니다. 공개 릴리스는 소형 WPF 부트스트래퍼 `VRCNT_5.15.0_Setup.exe`와 두 페이로드를 사용합니다.

공식 빌드는 [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases)에 게시됩니다.
설치 프로그램은 호환되는 NVIDIA 하드웨어를 감지하면 CUDA를 권장하지만 CPU를 직접 선택할 수 있습니다. 서명된 매니페스트가 CPU 또는 CUDA의 정확한 파트 수를 결정하므로 두 변형의 파트 수는 같을 필요가 없습니다. 포터블 실행 시 선택한 파트와 서명된 매니페스트를 함께 두고 `.7z.001`을 7-Zip으로 압축 해제한 후 `VRCNT.exe`를 실행하세요.

다운로드한 모델 및 설정은 `%LOCALAPPDATA%\VRCNTData`에 저장됩니다. 안정적인 설치 관리자는 `%LOCALAPPDATA%\VRCNTInstaller\VRCNT.Setup.exe`에 있으며 설치, 업데이트 및 런타임 전환 중 사용자 데이터를 보존합니다.

## 프로젝트 계보

VRCNT는 misyaguziya의 [VRCT](https://github.com/misyaguziya/VRCT)를 기반으로 합니다.
원본 프로젝트와 이 포크 프로젝트는 모두 MIT 라이선스 하에 배포됩니다.

VRCNT 전용 문제는 업스트림 VRCT 트래커가 아닌
[VRCNT Issue Tracker](https://github.com/awakenginexe/VRCNT/issues)에
제보해 주세요.

## 라이선스 및 면책 조항

[LICENSE](../LICENSE) 및 [NOTICE.md](../NOTICE.md)를 참고하세요. VRCNT는 비공식 소프트웨어이며 VRChat Inc.의 승인을 받지 않았습니다. VRChat 및 관련 자산은 VRChat Inc.의 상표 또는 등록 상표입니다.
