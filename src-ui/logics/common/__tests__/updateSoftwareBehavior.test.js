import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import Babel from "@babel/standalone";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import semver from "semver";

const load = (file, modules) => {
    const module = { exports: {} };
    const source = Babel.transform(fs.readFileSync(`src-ui/logics/common/${file}`, "utf8"), { plugins: ["transform-modules-commonjs"] }).code;
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`)((name) => modules[name], module, module.exports);
    return module.exports;
};

test("authoritative release metadata survives backend broadcasts and stable rejects legacy RC notification", () => {
    let info = { data: { catalog_checked: true, releases: ["stable notes"], new_version: "5.16.0", is_update_available: true } };
    const { useSoftwareVersion } = load("useSoftwareVersion.js", {
        semver,
        "@useStdoutToPython": { useStdoutToPython: () => ({}) },
        "@store": {
            useStore_SoftwareVersion: () => ({ currentSoftwareVersion: { data: "5.13.0" } }),
            useStore_LatestSoftwareVersionInfo: () => ({ currentLatestSoftwareVersionInfo: info, updateLatestSoftwareVersionInfo: (fn) => { info = { data: fn(info) }; } }),
        },
    });
    useSoftwareVersion().updateSoftwareVersionInfo({ is_update_available: false, new_version: "6.0.0-rc.3" });
    assert.equal(info.data.new_version, "5.16.0");
    assert.deepEqual(info.data.releases, ["stable notes"]);
    info = { data: { new_version: "5.13.0", is_update_available: false } };
    useSoftwareVersion().updateSoftwareVersionInfo({ is_update_available: true, new_version: "6.0.0-rc.3" });
    assert.equal(info.data.is_update_available, false);
});

test("selected release uses native signed Update resource, deduplicates installation and opens pages through opener", async () => {
    const calls = [], errors = [];
    let info = { data: { catalog_checked: true, new_version: "6.0.0-rc.3", is_update_available: true, release_url: "https://github.com/awakenginexe/VRCNT/releases/tag/v6.0.0-rc.3" } };
    const { useUpdateSoftware } = load("useUpdateSoftware.js", {
        react: React,
        "@tauri-apps/api/core": { invoke: async (...args) => { calls.push(args); return { rid: 42, version: "6.0.0-rc.3" }; } },
        "@tauri-apps/plugin-updater": {
            check: async () => { throw new Error("Unexpected unpinned update check"); },
            Update: class {
                constructor(metadata) { assert.equal(metadata.rid, 42); this.version = metadata.version; }
                async downloadAndInstall(callback) { calls.push("install"); callback({ event: "Started", data: { contentLength: 10 } }); callback({ event: "Progress", data: { chunkLength: 10 } }); callback({ event: "Finished" }); }
                async close() { calls.push("close"); }
            },
        },
        "@tauri-apps/plugin-process": { relaunch: async () => calls.push("relaunch") },
        "@tauri-apps/plugin-opener": { openUrl: async (url) => calls.push(["open", url]) },
        "@useI18n": { useI18n: () => ({ t: (key) => key }) },
        "./useSoftwareVersion": { useSoftwareVersion: () => ({ currentLatestSoftwareVersionInfo: info, updateLatestSoftwareVersionInfo: (fn) => { info = { data: fn(info) }; } }) },
        "./useNotificationStatus": { useNotificationStatus: () => ({ showNotification_Error: (error) => errors.push(error), showNotification_Success() {} }) },
        "./tauriRuntime": { isTauriRuntime: () => true },
    });
    const dom = new JSDOM("<div id='root'></div>");
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let hook;
    const Hook = () => { hook = useUpdateSoftware(); return null; };
    const root = createRoot(document.getElementById("root"));
    try {
        await act(() => root.render(React.createElement(Hook)));
        await act(async () => { await Promise.all([hook.updateSoftware(), hook.updateSoftware()]); });
        assert.deepEqual(calls, [["check_release_update", { releaseTag: "v6.0.0-rc.3" }], "install", "relaunch", "close"]);
        await hook.openReleaseFallback();
        assert.deepEqual(calls.at(-1), ["open", info.data.release_url]);
        assert.equal(await hook.openReleaseFallback("javascript:alert(1)"), false);
        assert.deepEqual(errors, []);
    } finally { await act(() => root.unmount()); dom.window.close(); }
});
