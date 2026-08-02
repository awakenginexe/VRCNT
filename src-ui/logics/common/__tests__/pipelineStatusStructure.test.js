import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PIPELINE_ACTIVE_OUTCOMES } from "../pipelineStatusUtils.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => (
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
);

const componentPath = (
    "src-ui/views/app/main_page/main_section/pipeline_status/PipelineStatus.jsx"
);
const stylesheetPath = (
    "src-ui/views/app/main_page/main_section/pipeline_status/PipelineStatus.module.scss"
);

test("pipeline status stays in collapsed rail diagnostics while resources remain in the conversation header", () => {
    const source = readSource("src-ui/views/app/main_page/main_section/MainSection.jsx");
    const controlRail = readSource(
        "src-ui/views/app/main_page/main_section/live_control_rail/LiveControlRail.jsx",
    );
    assert.match(source, /import \{ LiveControlRail \} from "\.\/live_control_rail\/LiveControlRail";/);
    assert.match(
        source,
        /<LiveControlRail\s*\/>[\s\S]*?<ResourceMonitor\s*\/>[\s\S]*?<MessageContainer\s+compactComposer\s*\/>/,
    );
    assert.match(controlRail, /import \{ PipelineStatus \} from "\.\.\/pipeline_status\/PipelineStatus";/);
    assert.match(controlRail, /<details/);
    assert.doesNotMatch(controlRail, /<details[^>]*\bopen\b/);
    assert.match(controlRail, /<PipelineStatus\s*\/>/);

    const styles = readSource("src-ui/views/app/main_page/main_section/MainSection.module.scss");
    assert.match(
        styles,
        /grid-template-rows:\s*var\(--main_page_topbar_height\)\s+minmax\(0,\s*1fr\)/,
    );
    assert.match(styles, /grid-template-columns:\s*minmax\(16\.5rem,\s*18\.2rem\)\s+minmax\(0,\s*1fr\)/);
});

test("the strip uses localized stage/source labels and existing semantic icons", () => {
    const source = readSource(componentPath);

    assert.match(source, /@images\/check_mark\.svg\?react/);
    assert.match(source, /@images\/warning\.svg\?react/);
    assert.match(source, /@images\/error\.svg\?react/);

    for (const key of [
        "source",
        "listening",
        "speaking",
        "transcription",
        "cloud",
        "queue",
        "total",
        "healthy",
        "slow",
        "error",
        "waiting",
        "unavailable",
    ]) {
        assert.match(source, new RegExp(`main_page\\.pipeline_status\\.${key}`), key);
    }
});

test("active elapsed time is component-local and never writes timer ticks to Jotai", () => {
    const source = readSource(componentPath);

    assert.deepEqual([...PIPELINE_ACTIVE_OUTCOMES], ["waiting", "running", "sending", "fallback"]);
    assert.match(source, /setInterval\([\s\S]*?,\s*250\)/);
    assert.match(source, /clearInterval\(/);
    assert.match(source, /isLatencyActive\(/);
    assert.doesNotMatch(source, /useAtom|useSetAtom|from "jotai"|updatePipelineStatus/);
});

test("one stable polite region debounces exceptional and recovery announcements", () => {
    const source = readSource(componentPath);

    assert.equal((source.match(/role="status"/g) ?? []).length, 1);
    assert.equal((source.match(/aria-live="polite"/g) ?? []).length, 1);
    assert.equal((source.match(/aria-atomic="true"/g) ?? []).length, 1);
    assert.match(source, /announcement_event/);
    assert.match(source, /setTimeout\([\s\S]*?,\s*450\)/);
    assert.match(source, /clearTimeout\(/);
    assert.match(source, /timeout_announcement/);
    assert.match(source, /overload_announcement/);
    assert.match(source, /error_announcement/);
    assert.match(source, /recovered_announcement/);
});

test("latency figures use tabular numbers and secondary details wrap responsively", () => {
    const styles = readSource(stylesheetPath);

    assert.match(styles, /font-variant-numeric:\s*tabular-nums/);
    assert.match(styles, /flex-wrap:\s*wrap/);
    assert.match(styles, /@media\s*\(max-width:/);
});

test("the minimum desktop workspace keeps the health strip to one compact row", () => {
    const styles = readSource(stylesheetPath);

    assert.match(
        styles,
        /@media\s*\(max-width:\s*72rem\)[\s\S]*?\.item\s*\{[\s\S]*?flex:\s*1\s+1\s+20%/,
    );
});

test("the atom hook applies immutable schema-v1 events through one backend route", () => {
    const store = readSource("src-ui/logics/store.js");
    const hook = readSource("src-ui/logics/common/usePipelineStatus.js");
    const commonIndex = readSource("src-ui/logics/common/index.js");
    const routes = readSource("src-ui/logics/useReceiveRoutes.js");

    assert.match(store, /Atom_PipelineStatus/);
    assert.match(store, /createEmptyPipelineStatusState\(\)/);
    assert.match(hook, /currentPipelineStatus/);
    assert.match(hook, /mergePipelineStatusEvent\(currentValue\.data,\s*payload\)/);
    assert.match(hook, /updateStorePipelineStatus\(\(currentValue\)\s*=>/);
    assert.match(commonIndex, /export \{ usePipelineStatus \} from "\.\/usePipelineStatus";/);

    assert.equal((routes.match(/"\/run\/pipeline_status"/g) ?? []).length, 1);
    assert.match(
        routes,
        /endpoint:\s*"\/run\/pipeline_status"[\s\S]*?hook_name:\s*"usePipelineStatus"[\s\S]*?method_name:\s*"updatePipelineStatus"/,
    );
});
