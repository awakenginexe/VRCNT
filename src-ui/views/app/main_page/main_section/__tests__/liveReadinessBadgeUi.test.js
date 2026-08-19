import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getLiveTranscriptionReadinessPresentation } from "../live_control_rail/liveTranscriptionReadinessBadgeUi.js";
import { getTranscriptionSwitchReadiness } from "../../sidebar_section/main_function_switch/mainFunctionReadinessUi.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Live places the readiness badge before its feature controls", () => {
    const rail = readSource("../live_control_rail/LiveControlRail.jsx");
    const badge = readSource("../live_control_rail/LiveTranscriptionReadinessBadge.jsx");

    assert.match(rail, /<LiveTranscriptionReadinessBadge[^>]*\/>/);
    assert.ok(rail.indexOf("<LiveTranscriptionReadinessBadge") < rail.indexOf("<MainFunctionSwitch"));
    assert.match(badge, /role="status"/);
    assert.match(badge, /data-state=\{presentation\.state\}/);
    assert.match(badge, /getLiveTranscriptionReadinessPresentation/);
});

test("Live controls consume the shared readiness helper and all model status atoms", () => {
    const rail = readSource("../live_control_rail/LiveControlRail.jsx");
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");

    assert.match(rail, /getAggregateTranscriptionReadiness/);
    assert.match(switches, /getTranscriptionModelReadiness/);
    for (const name of [
        "currentWhisperWeightTypeStatus",
        "currentWhisperThaiWeightTypeStatus",
        "currentVoskWeightTypeStatus",
        "currentParakeetWeightTypeStatus",
        "currentSenseVoiceWeightTypeStatus",
    ]) {
        assert.match(switches, new RegExp(name));
    }
});

test("Translation keeps its existing tooltip detail while the backend is unavailable", () => {
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");
    const translationItem = switches.match(
        /\{\s*switch_id:\s*"translation"([\s\S]*?)\n        \},/,
    )?.[1] ?? "";

    assert.match(translationItem, /isDisabled:\s*currentIsBackendReady\.data\s*!==\s*true/);
    assert.doesNotMatch(translationItem, /disabledReason|disabledDetail/);
});

const localizedLabels = {
    ready: "Localized Ready",
    notReady: "Localized Not Ready",
    loading: "Localized Loading",
    sourceLabels: {
        send: "Localized Speaking",
        receive: "Localized Listening",
    },
};

test("readiness badge presentation covers ready, loading, and not-ready states", () => {
    const formatMissingDetail = (item, sourceLabel) => `${sourceLabel} · ${item.engine} · ${item.model}`;

    assert.deepEqual(getLiveTranscriptionReadinessPresentation({
        readiness: { state: "ready", missing: [] },
        labels: localizedLabels,
        formatMissingDetail,
    }), {
        state: "ready",
        label: "Localized Ready",
        detail: "",
    });
    assert.deepEqual(getLiveTranscriptionReadinessPresentation({
        readiness: { state: "loading", missing: [] },
        labels: localizedLabels,
        formatMissingDetail,
    }), {
        state: "loading",
        label: "Localized Loading",
        detail: "",
    });
    assert.deepEqual(getLiveTranscriptionReadinessPresentation({
        readiness: {
            state: "not_ready",
            missing: [{ source: "send", engine: "Whisper", model: "tiny" }],
        },
        labels: localizedLabels,
        formatMissingDetail,
    }), {
        state: "not_ready",
        label: "Localized Not Ready",
        detail: "Localized Speaking · Whisper · tiny",
    });
});

test("readiness badge keeps source labels localized and distinguishes cloud credentials", () => {
    const presentation = getLiveTranscriptionReadinessPresentation({
        readiness: {
            state: "not_ready",
            missing: [
                { source: "send", engine: "Whisper", model: "tiny" },
                { source: "receive", engine: "Whisper Cloud", model: "whisper-large-v3-turbo" },
            ],
        },
        labels: localizedLabels,
        formatMissingDetail: (item, sourceLabel) => item.engine === "Whisper Cloud"
            ? `${sourceLabel} · ${item.engine} · ${item.model}: localized credential required`
            : `${sourceLabel} · ${item.engine} · ${item.model}: localized model download required`,
    });

    assert.match(presentation.detail, /Localized Speaking/);
    assert.match(presentation.detail, /Localized Listening/);
    assert.match(presentation.detail, /Whisper Cloud · whisper-large-v3-turbo: localized credential required/);
    assert.doesNotMatch(presentation.detail, /Whisper Cloud[^,]*download/);
});

test("transcription switches stay enabled while readiness is loading", () => {
    const copies = {
        backendWaiting: "backend waiting",
        localModelCopy: "local model missing",
        cloudCredentialCopy: "cloud credential missing",
    };

    assert.deepEqual(getTranscriptionSwitchReadiness({
        readiness: { state: "loading", engine: "Whisper", model: "tiny" },
        isBackendReady: true,
        ...copies,
    }), {
        isDisabled: false,
        disabledReason: "",
        disabledDetail: "",
    });
    assert.deepEqual(getTranscriptionSwitchReadiness({
        readiness: { state: "not_ready", engine: "Whisper", model: "tiny" },
        isBackendReady: true,
        ...copies,
    }), {
        isDisabled: true,
        disabledReason: "local model missing",
        disabledDetail: "local model missing",
    });
    assert.deepEqual(getTranscriptionSwitchReadiness({
        readiness: { state: "not_ready", engine: "Whisper Cloud", model: "whisper-large-v3-turbo" },
        isBackendReady: true,
        ...copies,
    }), {
        isDisabled: true,
        disabledReason: "cloud credential missing",
        disabledDetail: "cloud credential missing",
    });
});
