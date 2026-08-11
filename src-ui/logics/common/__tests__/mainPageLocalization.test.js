import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

const readSource = (relativePath) => (
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
);

const getPathValue = (source, dottedPath) => (
    dottedPath.split(".").reduce((current, key) => current?.[key], source)
);

const getInterpolationNames = (value) => (
    [...String(value).matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)]
        .map((match) => match[1])
        .sort()
);

const translationStatusCopy = {
    "en.yml": {
        queued: "Waiting for {{engine}} · {{elapsed}}",
        sending: "Translating with {{engine}} · {{elapsed}}",
        fallback: "{{previousEngine}} is slow · trying {{engine}}",
        success_meta: "{{engine}} · {{duration}}",
        timeout: "Translation unavailable · {{engine}} timed out",
        error: "Translation unavailable · {{engine}} failed",
        rate_limited: "Translation unavailable · {{engines}} rate limited · automatic test in {{seconds}}s",
        skipped_overload: "Translation skipped · queue overloaded",
        no_provider: "Translation unavailable · no provider selected",
        unavailable: "Translation unavailable",
        queue_position: "Queue {{position}}",
        retry: "Translate",
    },
    "th.yml": {
        queued: "กำลังรอ {{engine}} · {{elapsed}}",
        sending: "กำลังแปลด้วย {{engine}} · {{elapsed}}",
        fallback: "{{previousEngine}} ช้า · กำลังลอง {{engine}}",
        success_meta: "{{engine}} · {{duration}}",
        timeout: "ไม่มีคำแปล · {{engine}} หมดเวลา",
        error: "ไม่มีคำแปล · {{engine}} ล้มเหลว",
        rate_limited: "ไม่มีคำแปล · {{engines}} ถูกจำกัดอัตรา · ทดสอบอัตโนมัติใน {{seconds}} วินาที",
        skipped_overload: "ข้ามการแปล · คิวทำงานหนักเกินไป",
        no_provider: "ไม่มีคำแปล · ยังไม่ได้เลือกผู้ให้บริการ",
        unavailable: "ไม่มีคำแปล",
        queue_position: "คิว {{position}}",
        retry: "แปลอีกครั้ง",
    },
    "ja.yml": {
        queued: "{{engine}} を待機中 · {{elapsed}}",
        sending: "{{engine}} で翻訳中 · {{elapsed}}",
        fallback: "{{previousEngine}} が遅延 · {{engine}} を試行中",
        success_meta: "{{engine}} · {{duration}}",
        timeout: "翻訳を利用できません · {{engine}} がタイムアウトしました",
        error: "翻訳を利用できません · {{engine}} が失敗しました",
        rate_limited: "翻訳を利用できません · {{engines}} はレート制限中 · {{seconds}}秒後に自動再試行",
        skipped_overload: "翻訳をスキップしました · キューが過負荷です",
        no_provider: "翻訳を利用できません · プロバイダーが未選択です",
        unavailable: "翻訳を利用できません",
        queue_position: "キュー {{position}}",
        retry: "翻訳",
    },
    "ko.yml": {
        queued: "{{engine}} 대기 중 · {{elapsed}}",
        sending: "{{engine}}로 번역 중 · {{elapsed}}",
        fallback: "{{previousEngine}} 지연 · {{engine}} 시도 중",
        success_meta: "{{engine}} · {{duration}}",
        timeout: "번역을 사용할 수 없음 · {{engine}} 시간 초과",
        error: "번역을 사용할 수 없음 · {{engine}} 실패",
        rate_limited: "번역을 사용할 수 없음 · {{engines}} 사용량 제한 · {{seconds}}초 후 자동 재시도",
        skipped_overload: "번역 건너뜀 · 대기열 과부하",
        no_provider: "번역을 사용할 수 없음 · 제공자 미선택",
        unavailable: "번역을 사용할 수 없음",
        queue_position: "대기열 {{position}}",
        retry: "번역",
    },
    "zh-Hans.yml": {
        queued: "正在等待 {{engine}} · {{elapsed}}",
        sending: "正在使用 {{engine}} 翻译 · {{elapsed}}",
        fallback: "{{previousEngine}} 响应缓慢 · 正在尝试 {{engine}}",
        success_meta: "{{engine}} · {{duration}}",
        timeout: "翻译不可用 · {{engine}} 请求超时",
        error: "翻译不可用 · {{engine}} 失败",
        rate_limited: "翻译不可用 · {{engines}} 已达到速率限制 · {{seconds}} 秒后自动重试",
        skipped_overload: "已跳过翻译 · 队列过载",
        no_provider: "翻译不可用 · 未选择服务商",
        unavailable: "翻译不可用",
        queue_position: "队列 {{position}}",
        retry: "翻译",
    },
    "zh-Hant.yml": {
        queued: "正在等待 {{engine}} · {{elapsed}}",
        sending: "正在使用 {{engine}} 翻譯 · {{elapsed}}",
        fallback: "{{previousEngine}} 回應緩慢 · 正在嘗試 {{engine}}",
        success_meta: "{{engine}} · {{duration}}",
        timeout: "翻譯無法使用 · {{engine}} 請求逾時",
        error: "翻譯無法使用 · {{engine}} 失敗",
        rate_limited: "翻譯無法使用 · {{engines}} 已達速率限制 · {{seconds}} 秒後自動重試",
        skipped_overload: "已略過翻譯 · 佇列過載",
        no_provider: "翻譯無法使用 · 未選擇服務商",
        unavailable: "翻譯無法使用",
        queue_position: "佇列 {{position}}",
        retry: "翻譯",
    },
};

test("main page visible copy is routed through localization", () => {
    const files = [
        "src-ui/views/app/main_page/main_section/MainSection.jsx",
        "src-ui/views/app/main_page/main_section/language_selector/LanguageSelector.jsx",
        "src-ui/views/app/main_page/main_section/top_bar/right_side_components/RightSideComponents.jsx",
        "src-ui/views/app/main_page/sidebar_section/language_settings/LanguageSettings.jsx",
        "src-ui/views/app/main_page/sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton.jsx",
        "src-ui/views/app/main_page/sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel.jsx",
        "src-ui/views/app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.jsx",
        "src-ui/views/app/main_page/sidebar_section/main_function_switch/mainFunctionTooltipMeta.js",
        "src-ui/views/app/App.jsx",
        "src-ui/views/app/others/blocking_operation_overlay/BlockingOperationOverlay.jsx",
        "src-ui/views/app/others/startup_status_banner/StartupStatusBanner.jsx",
        "src-ui/views/app/_app_controllers/StartPythonController.jsx",
        "src-ui/logics/main/useMainFunction.js",
    ];
    const source = files.map(readSource).join("\n");
    const forbiddenPhrases = [
        "Voice input and personal translation output",
        "Choose who you want VRCNT-Next to translate for",
        "Quick switches for translation and transcription",
        "Your speaking language",
        "Your translation language",
        "Quick switch between CPU and GPU",
        "Processing Type",
        "Locked to Auto for this engine",
        "Choose the runtime mode for Whisper",
        "Overlay(VR)",
        "Starting translator",
        "Waiting for backend startup",
        "Turn chat translation on or off.",
        "Open app configuration.",
        "only enables languages supported by the selected model.",
        "Operation in progress",
        "Starting VRCNT-Next",
        "Current step",
        "Startup progress",
        "Working…",
        "Startup could not finish",
        "Restart VRCNT-Next. If this continues, check the application log.",
        "The backend is unavailable. Your change was not applied.",
        "The backend stopped. Restart VRCNT-Next to continue.",
    ];

    for (const phrase of forbiddenPhrases) {
        assert.equal(source.includes(phrase), false, phrase);
    }
});

test("progressive translation status copy matches all six locale contracts", () => {
    for (const [localeFile, expectedCopy] of Object.entries(translationStatusCopy)) {
        const locale = yaml.load(readSource(`locales/${localeFile}`));
        assert.deepEqual(
            locale?.main_page?.message_log?.translation_status,
            expectedCopy,
            localeFile,
        );
    }
});

test("translation entry contains no visible English status copy", () => {
    const relativePath = (
        "src-ui/views/app/main_page/main_section/message_container/log_box/"
        + "message_container/translation_entry/TranslationEntry.jsx"
    );
    assert.equal(
        fs.existsSync(path.join(repoRoot, relativePath)),
        true,
        "TranslationEntry.jsx must route visible status copy through i18n",
    );

    const source = readSource(relativePath);
    const forbiddenPhrases = Object.values(translationStatusCopy["en.yml"]);

    for (const phrase of forbiddenPhrases) {
        assert.equal(source.includes(phrase), false, phrase);
    }
});

test("Live Weave navigation and empty-state copy exists in every locale", () => {
    const requiredPaths = [
        ["navigation", "live"],
        ["navigation", "history"],
        ["navigation", "models"],
        ["navigation", "overlay"],
        ["navigation", "settings"],
        ["session_live"],
        ["conversation_title"],
        ["conversation_detail"],
        ["empty_title"],
        ["empty_detail"],
    ];

    for (const localeFile of ["en.yml", "th.yml", "ja.yml", "ko.yml", "zh-Hans.yml", "zh-Hant.yml"]) {
        const liveWeave = yaml.load(readSource(`locales/${localeFile}`))?.main_page?.live_weave;
        for (const pathParts of requiredPaths) {
            const value = pathParts.reduce((current, key) => current?.[key], liveWeave);
            assert.equal(typeof value, "string", `${localeFile}: main_page.live_weave.${pathParts.join(".")}`);
            assert.notEqual(value.trim(), "", `${localeFile}: main_page.live_weave.${pathParts.join(".")}`);
        }
    }
});

test("redesigned guided setup schema exists in every supported locale", () => {
    const localeFiles = ["en.yml", "th.yml", "ja.yml", "ko.yml", "zh-Hans.yml", "zh-Hant.yml"];
    const requiredKeys = [
        "step_app_language",
        "step_language",
        "step_translation",
        "step_audio",
        "step_transcription_translation",
        "step_vrchat",
        "app_language_title",
        "language_title",
        "translation_title",
        "understanding_language",
        "understanding_language_detail",
        "transcription_translation_title",
        "speech_recognition_engine",
        "translation_service",
        "offline_translation_model",
        "advanced",
        "outgoing",
        "incoming",
        "tiny_whisper_warning",
        "skip",
    ];
    const approvedEnglish = {
        step_language: "Language",
        step_translation: "Translation",
        step_transcription_translation: "Transcription and Translation",
        step_vrchat: "VRChat",
        understanding_language: "Your understanding language",
        understanding_language_detail: "The language VRCNT translates incoming speech into for you.",
        skip: "Skip setup",
        tiny_whisper_warning: "Whisper tiny is mainly suitable for English and may perform poorly in other languages.",
    };

    for (const localeFile of localeFiles) {
        const source = readSource(`locales/${localeFile}`);
        const guidedSetup = yaml.load(source)?.main_page?.guided_setup;
        for (const key of requiredKeys) {
            assert.match(source, new RegExp(`\\n\\s+${key}:`), `${localeFile}: ${key}`);
            assert.equal(typeof guidedSetup?.[key], "string", `${localeFile}: main_page.guided_setup.${key}`);
            assert.notEqual(guidedSetup[key].trim(), "", `${localeFile}: main_page.guided_setup.${key}`);
        }
    }

    const english = yaml.load(readSource("locales/en.yml"))?.main_page?.guided_setup;
    for (const [key, value] of Object.entries(approvedEnglish)) {
        assert.equal(english?.[key], value, `en.yml: main_page.guided_setup.${key}`);
    }
});

test("guided setup component locale keys exist with matching interpolation in all supported locales", () => {
    const componentSources = [
        readSource("src-ui/views/app/main_page/guided_setup/GuidedSetup.jsx"),
        readSource("src-ui/views/app/main_page/guided_setup/TranscriptionTranslationStep.jsx"),
    ].join("\n");
    const staticKeys = new Set(
        [...componentSources.matchAll(/\bt\(\s*"([^"]+)"/g)]
            .map((match) => match[1])
            .filter((key) => (
                key.startsWith("main_page.guided_setup.")
                || key.startsWith("main_page.engines_workspace.")
                || key.startsWith("main_page.translation_models.")
                || key.startsWith("main_page.preset.")
                || key.startsWith("config_page.translation_models.")
                || key.startsWith("config_page.model_download_error.")
                || key.startsWith("config_page.common.model_download.")
            )),
    );
    for (const key of [
        "main_page.preset.fast",
        "main_page.preset.balanced",
        "main_page.preset.good",
        "main_page.preset.precise",
    ]) {
        staticKeys.add(key);
    }

    const localeFiles = ["en.yml", "th.yml", "ja.yml", "ko.yml", "zh-Hans.yml", "zh-Hant.yml"];
    const locales = Object.fromEntries(
        localeFiles.map((localeFile) => [
            localeFile,
            yaml.load(readSource(`locales/${localeFile}`)),
        ]),
    );
    const english = locales["en.yml"];

    for (const key of [...staticKeys].sort()) {
        const englishValue = getPathValue(english, key);
        assert.equal(typeof englishValue, "string", `en.yml: ${key}`);
        const expectedInterpolations = getInterpolationNames(englishValue);

        for (const localeFile of localeFiles) {
            const value = getPathValue(locales[localeFile], key);
            assert.equal(typeof value, "string", `${localeFile}: ${key}`);
            assert.notEqual(value.trim(), "", `${localeFile}: ${key}`);
            assert.deepEqual(
                getInterpolationNames(value),
                expectedInterpolations,
                `${localeFile}: ${key} interpolation parity`,
            );
        }
    }
});
