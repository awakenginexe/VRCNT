import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import Babel from "@babel/standalone";

test("launch notification waits for catalog and startup, postpones other dialogs, and opens only once", async () => {
    const file = path.resolve("src-ui/views/app/others/update_notification_controller/UpdateNotificationController.jsx");
    let data = { info: { is_update_available: true, new_version: "5.16.0" }, status: "loading", backend: false, modal: "", initializing: true };
    const opened = [];
    const modules = {
        react: React,
        "@logics_common": {
            useIsBackendReady: () => ({ currentIsBackendReady: { data: data.backend } }),
            useSoftwareVersion: () => ({ currentLatestSoftwareVersionInfo: { data: data.info } }),
            useNotificationStatus: () => ({ showNotification_Warning() {} }),
        },
        "@logics_common/useReleaseUpdates.js": { useReleaseUpdates: () => data },
        "@store": {
            useStore_OpenedQuickSetting: () => ({ currentOpenedQuickSetting: { data: data.modal }, updateOpenedQuickSetting: (value) => opened.push(value) }),
            useStore_InitStatus: () => ({ currentInitStatus: { data: { visible: data.initializing } } }),
        },
        "@useI18n": { useI18n: () => ({ t: (key) => key }) },
    };
    const module = { exports: {} };
    const source = Babel.transform(fs.readFileSync(file, "utf8"), { plugins: ["transform-modules-commonjs"] }).code;
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })((name) => modules[name], module, module.exports);
    const dom = new JSDOM("<div id='root'></div>");
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.getElementById("root"));
    const render = () => act(() => root.render(React.createElement(module.exports.UpdateNotificationController)));
    try {
        await render(); assert.deepEqual(opened, []);
        data = { ...data, backend: true }; await render(); assert.deepEqual(opened, []);
        data = { ...data, status: "ready" }; await render(); assert.deepEqual(opened, []);
        data = { ...data, initializing: false, modal: "overlay" }; await render(); assert.deepEqual(opened, []);
        data = { ...data, modal: "" }; await render(); assert.deepEqual(opened, ["update_software"]);
        data = { ...data, info: { ...data.info, new_version: "5.17.0" } }; await render();
        assert.deepEqual(opened, ["update_software"]);
    } finally { await act(() => root.unmount()); dom.window.close(); }
});
