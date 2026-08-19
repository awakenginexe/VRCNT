import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Live places the readiness badge before its feature controls", () => {
    const rail = readSource("../live_control_rail/LiveControlRail.jsx");
    const badge = readSource("../live_control_rail/LiveTranscriptionReadinessBadge.jsx");

    assert.match(rail, /<LiveTranscriptionReadinessBadge[^>]*\/>/);
    assert.ok(rail.indexOf("<LiveTranscriptionReadinessBadge") < rail.indexOf("<MainFunctionSwitch"));
    assert.match(badge, /role="status"/);
    assert.match(badge, /data-state=\{readiness\.state\}/);
    assert.match(badge, /readiness\.missing\.map\(\(item\) => item\.detail\)\.join\(\", \"\)/);
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
