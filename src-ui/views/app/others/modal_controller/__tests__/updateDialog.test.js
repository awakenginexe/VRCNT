import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../../../../../");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const modal = read("src-ui/views/app/others/modal_controller/update_modal/UpdateModal.jsx");
const modalStyles = read("src-ui/views/app/others/modal_controller/update_modal/UpdateModal.module.scss");
const controller = read("src-ui/views/app/others/modal_controller/ModalController.jsx");
const controllerStyles = read("src-ui/views/app/others/modal_controller/ModalController.module.scss");
const appIndex = read("src-ui/views/app/index.jsx");

test("update dialog presents release history and safe markdown with actionable states", () => {
    assert.match(modal, /export const UpdateDialog/);
    assert.match(modal, /ReactMarkdown/);
    assert.match(modal, /skipHtml/);
    assert.match(modal, /components=\{[^}]*img/);
    assert.match(modal, /noopener noreferrer/);
    assert.match(modal, /notes_complete/);
    assert.match(modal, /catalog_checked/);
    assert.match(modal, /is_update_available/);
    assert.match(modal, /updateState\.status/);
    assert.match(modal, /onRefresh/);
    assert.match(modal, /onRelease/);
    assert.match(modal, /onUpdate/);
    assert.match(modal, /release\.body/);
    assert.match(modal, /release\.published_at/);
    assert.match(modalStyles, /release_list/);
    assert.match(modalStyles, /overflow-y:\s*auto/);
    assert.match(modalStyles, /sticky|position:\s*sticky/);
});

test("update modal adapter uses release catalog while retaining updater progress and fallback", () => {
    assert.match(modal, /useReleaseUpdates/);
    assert.match(modal, /useUpdateSoftware/);
    assert.match(modal, /openReleaseFallback/);
    assert.match(modal, /updateState/);
});

test("modal controller supplies a focus-managed dialog and blocks backdrop close during installation", () => {
    assert.match(controller, /role="dialog"/);
    assert.match(controller, /aria-modal="true"/);
    assert.match(controller, /aria-labelledby=/);
    assert.match(controller, /keydown/);
    assert.match(controller, /Tab/);
    assert.match(controller, /Escape/);
    assert.match(controller, /focus\(\)/);
    assert.match(controller, /restore|previousFocus|activeElement/);
    assert.match(controller, /isUpdateInstallingRef\.current/);
    assert.match(controller, /bg_onclick_close_area/);
    assert.match(controllerStyles, /focus-visible/);
});

test("update preview is development-only, browser-only, query-gated, and local-fixture-backed", () => {
    assert.match(appIndex, /import\.meta\.env\.DEV/);
    assert.match(appIndex, /isTauriRuntime\(\)/);
    assert.match(appIndex, /get\("preview"\) === "update"/);
    assert.match(appIndex, /UpdatePreview/);
    assert.match(appIndex, /5\.13/);
    assert.match(appIndex, /5\.16/);
    assert.match(appIndex, /createBrowserPreviewWindow/);
});

test("update popup copy exists in every supported locale", () => {
    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const content = read(`locales/${locale}.yml`);
        assert.match(content, /update_modal:[\s\S]*?later:/);
        assert.match(content, /update_modal:[\s\S]*?release_notes:/);
        assert.match(content, /update_modal:[\s\S]*?update_to_version:/);
        assert.match(content, /update_modal:[\s\S]*?retry:/);
        assert.match(content, /update_modal:[\s\S]*?notes_unavailable:/);
    }
});
