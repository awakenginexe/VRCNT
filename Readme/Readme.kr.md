<p align="center">
  <img src="../logo/VRCNT.png" alt="VRCNT" width="420" />
</p>

<p align="center">
  <strong>VRChat을 위한 실시간 번역 및 음성 텍스트 변환(STT) 도구</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-5.6.3-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-9B6DFF?style=for-the-badge&labelColor=08070B" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5DE2B5?style=for-the-badge&labelColor=08070B" />
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

## VRCNT 5.6.3 미리보기

<p align="center">
  <font size="4"><strong>라이브</strong></font>
</p>

<p align="center">
  <img src="../preview/Live.png" alt="라이브" width="960" />
</p>

<p align="center">
  <font size="4"><strong>엔진 및 오디오</strong></font>
</p>

<p align="center">
  <img src="../preview/Engine&Audio.png" alt="엔진 및 오디오" width="960" />
</p>

<p align="center">
  <font size="4"><strong>음성 모델</strong></font>
</p>

<p align="center">
  <img src="../preview/SpeechModels.png" alt="음성 모델" width="960" />
</p>

<p align="center">
  <font size="4"><strong>번역 모델</strong></font>
</p>

<p align="center">
  <img src="../preview/TranslationModels.png" alt="번역 모델" width="960" />
</p>

<p align="center">
  <font size="4"><strong>오버레이 스튜디오</strong></font>
</p>

<p align="center">
  <img src="../preview/OverlayStudio.png" alt="오버레이 스튜디오" width="960" />
</p>

<p align="center">
  <font size="4"><strong>사용자 지정</strong></font>
</p>

<p align="center">
  <img src="../preview/Customize.png" alt="사용자 지정" width="960" />
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
- CPU 처리로 전환 가능한 단일 CUDA 지원 Windows 빌드.
- 매트 블랙과 바이올렛 컬러로 구성된 집중력 높은 데스크톱 인터페이스.

## 하드웨어 및 성능

VRCNT는 CPU 전용 시스템에서도 작동하지만, NVIDIA GPU를 사용할 때 가장 뛰어난 실시간 성능을 발휘합니다.

VRCNT에는 로컬 AI 런타임 종속성이 포함되어 있어 애플리케이션 패키지 용량이 큽니다. 이를 통해 모든 대화에서 클라우드 서비스에 의존하지 않고 로컬 음성 처리 및 번역 기능을 사용할 수 있습니다.

- 음성 모델은 설치 후 추가 다운로드가 필요할 수 있습니다.
- 대형 모델일수록 더 많은 RAM 또는 VRAM이 필요하므로 사용자의 PC 사양에 맞는 모델을 선택하세요.
- CPU 전용 모드가 지원되지만, 대형 음성 모델을 사용할 경우 지연 시간이 길어질 수 있습니다.
- 클라우드 엔진을 사용하면 저사양 PC의 부담을 줄일 수 있지만 인터넷 연결이 필요합니다.

## 빌드 (Build)

종속성 설치:

```powershell
npm ci
```

CUDA 사이드카 및 Windows 앱 빌드:

```powershell
npm run build-cuda
```

생성된 실행 파일 및 설치 프로그램은 `src-tauri/target/release` 경로에 생성됩니다.

공식 빌드는 [GitHub Releases](https://github.com/awakenginexe/VRCNT/releases)에 게시됩니다.
설치 프로그램은 서명된 3개의 분할 패키지 파일을 다운로드하거나,
`VRCNT_<version>.7z.001`부터 `.003`까지 `package-manifest.json` 및 `package-manifest.json.sig`와 함께 동일한 디렉터리에 두고 직접 사용할 수 있습니다.
VRCNT를 포터블로 실행하려면 3개 부분을 같은 폴더에 유지하고 7-Zip으로 `.7z.001`을 압축 해제한 후, 해제된 디렉터리에서 `VRCNT.exe`를 실행하세요.

다운로드한 모델 및 설정은 `%LOCALAPPDATA%\VRCNTData`에 저장됩니다. VRCNT 4.1.0은 새 디렉터리가 아직 존재하지 않는 경우 기존 `VRCNT-NextData` 디렉터리를 자동으로 마이그레이션합니다.

## 프로젝트 계보

VRCNT는 misyaguziya의 [VRCT](https://github.com/misyaguziya/VRCT)를 기반으로 합니다.
원본 프로젝트와 이 포크 프로젝트는 모두 MIT 라이선스 하에 배포됩니다.

VRCNT 전용 문제는 업스트림 VRCT 트래커가 아닌
[VRCNT Issue Tracker](https://github.com/awakenginexe/VRCNT/issues)에
제보해 주세요.

## 라이선스 및 면책 조항

[LICENSE](../LICENSE) 및 [NOTICE.md](../NOTICE.md)를 참고하세요. VRCNT는 비공식 소프트웨어이며 VRChat Inc.의 승인을 받지 않았습니다. VRChat 및 관련 자산은 VRChat Inc.의 상표 또는 등록 상표입니다.
