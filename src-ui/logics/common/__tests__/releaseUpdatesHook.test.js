import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import Babel from "@babel/standalone";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import * as jotai from "jotai";
import * as selection from "../releaseUpdates.js";

test("shared checks deduplicate requests, retain authoritative notes, and detect RC-to-stable on catalog failure", async () => {
    const atom = jotai.atom({ data: { is_update_available: false } });
    const store = jotai.createStore();
    let calls = 0, fail = false, fallbackCalls = 0, closed = 0;
    const modules = {
        react: React, jotai, "@store": { Atom_LatestSoftwareVersionInfo: atom },
        "@tauri-apps/api/core": { invoke: async () => "6.0.0-rc.2" },
        "@tauri-apps/plugin-http": { fetch: async () => {
            calls++;
            if (fail) throw new Error("403");
            return { ok: true, json: async () => [{ tag_name: "v6.0.0-rc.3", published_at: "2026-09-01", body: "RC changes", assets: [{ name: "latest.json", state: "uploaded" }, { name: "VRCNT_6.0.0_Setup.exe", state: "uploaded" }] }], headers: { get: () => null } };
        } },
        "@tauri-apps/plugin-updater": { check: async () => { fallbackCalls++; return { version: "6.0.0", close: async () => { closed++; } }; } },
        "../../../package.json": { version: "6.0.0" },
        "./tauriRuntime.js": { isTauriRuntime: () => true },
        "./releaseUpdates.js": selection,
    };
    const module = { exports: {} };
    const file = "src-ui/logics/common/useReleaseUpdates.js";
    const source = Babel.transform(fs.readFileSync(file, "utf8"), { plugins: ["transform-modules-commonjs"] }).code;
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`)((name) => modules[name], module, module.exports);
    const dom = new JSDOM("<div id='root'></div>");
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let result;
    const Hook = () => { result = module.exports.useReleaseUpdates(); return null; };
    const root = createRoot(document.getElementById("root"));
    try {
        await act(async () => root.render(React.createElement(jotai.Provider, { store }, React.createElement(React.StrictMode, null, React.createElement(Hook), React.createElement(Hook)))));
        assert.equal(calls, 1);
        assert.equal(result.info.new_version, "6.0.0-rc.3");
        assert.equal(result.status, "ready");
        fail = true;
        await act(() => result.refresh());
        assert.equal(result.status, "error");
        assert.equal(result.info.new_version, "6.0.0-rc.3");
        assert.equal(result.info.releases[0].body, "RC changes");
        assert.equal(fallbackCalls, 0);
        await act(async () => {
            store.set(atom, { data: { is_update_available: false } });
        });
        await act(() => result.refresh());
        assert.equal(result.status, "error");
        assert.equal(result.info.is_update_available, true);
        assert.equal(result.info.new_version, "6.0.0");
        assert.equal(result.info.notes_complete, false);
        assert.equal(closed, fallbackCalls);
    } finally { await act(() => root.unmount()); dom.window.close(); }
});
