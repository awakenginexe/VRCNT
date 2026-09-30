import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import Babel from "@babel/standalone";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { atom, createStore, Provider, useAtomValue } from "jotai";
import * as jotai from "jotai";

const require = createRequire(import.meta.url);
const base = path.resolve("src-ui/views/app/main_page/main_section/message_container/log_box");
const logs = atom({ state: "ok", data: [] });
const input = atom({ state: "ok", data: "" });
const scale = atom(100);
const shared = { log_box_ref: null, last_executed_time_startTyping: 0 };
const backendCalls = [];
const styles = new Proxy({}, { get: (_, key) => key });
const translate = (key) => key;
const mocks = {
    jotai,
    "@store": {
        store: shared, Atom_MessageLogs: logs, Atom_MessageInputValue: input,
        useStore_MessageLogs: () => ({ currentMessageLogs: useAtomValue(logs) }),
    },
    "@useI18n": { useI18n: () => ({ t: translate }) },
    "@logics_configs": { useAppearance: () => ({
        currentMessageLogUiScaling: { data: useAtomValue(scale) }, currentShowResendButton: { data: true },
    }) },
    "@useStdoutToPython": { useStdoutToPython: () => ({
        asyncStdoutToPython: (...args) => backendCalls.push(args),
    }) },
    "@logics_main": { useMessageLogScroll: () => ({ scrollToBottom() {}, isScrolling: false }) },
};
function load(file, cache = new Map()) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = Babel.transform(fs.readFileSync(file, "utf8"), {
        presets: [["react", { runtime: "automatic" }]], plugins: ["transform-modules-commonjs"],
    }).code;
    const localRequire = (name) => {
        if (name.endsWith(".scss")) return styles;
        if (name === "@logics_common") return {
            useMessage: () => ({ currentMessageLogs: useAtomValue(logs), sendMessage() {}, updateMessageInputValue() {}, retryTranslation() {} }),
            ...(fs.existsSync("src-ui/logics/common/useMessageActions.js") ? load(path.resolve("src-ui/logics/common/useMessageActions.js"), cache) : {}),
        };
        if (mocks[name]) return mocks[name];
        if (name.startsWith("@logics_common/")) return load(path.resolve("src-ui/logics/common", name.slice(15)), cache);
        if (name.includes("MessageSubMenuContainer")) return { MessageSubMenuContainer: () => null };
        if (name.startsWith(".")) {
            let target = path.resolve(path.dirname(file), name);
            if (!path.extname(target)) target += fs.existsSync(target + ".jsx") ? ".jsx" : ".js";
            return load(target, cache);
        }
        return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(localRequire, module, module.exports);
    return module.exports;
}

test("large history mounts a bounded window, preserves browsing, and follows new output at the bottom", async (t) => {
    const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.MutationObserver = dom.window.MutationObserver;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const observers = new Set();
    class ResizeObserver {
        constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); observers.delete(this); }
    }
    dom.window.ResizeObserver = globalThis.ResizeObserver = ResizeObserver;
    const proto = dom.window.HTMLElement.prototype;
    let width = 800;
    const height = (el) => el.id === "log_container" ? 600 : el.dataset.index != null
        ? (el.textContent.includes("expanded") ? 240 : 100) * state.get(scale) / 100 * 800 / width : parseFloat(el.style.height) || 100;
    proto.getBoundingClientRect = function () { return { width, height: height(this) }; };
    Object.defineProperty(proto, "offsetHeight", { get() { return height(this); } });
    Object.defineProperty(proto, "offsetWidth", { get() { return width; } });
    Object.defineProperty(proto, "clientHeight", { get() { return height(this); } });
    Object.defineProperty(proto, "scrollHeight", { get() { return parseFloat(this.firstElementChild?.style.height) || 600; } });
    proto.scrollTo = function ({ top }) { this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - 600)); setTimeout(() => this.dispatchEvent(new dom.window.Event("scroll")), 0); };
    const state = createStore();
    const entry = (i) => ({ id: `m${i}`, category: "sent", status: "ok", created_at: "12:00", messages: {
        original: { message: `message ${i}`, transliteration: [] }, translations: [],
    } });
    state.set(logs, { state: "ok", data: Array.from({ length: 10000 }, (_, i) => entry(i)) });
    const { LogBox } = load(path.join(base, "LogBox.jsx"));
    const root = createRoot(document.getElementById("root"));
    const settle = async (fn = () => {}) => act(async () => { fn(); });
    const waitForLayout = async () => {
        for (let pass = 0; pass < 2; pass++) await act(async () => {
            for (const observer of observers) observer.callback([...observer.targets].map((target) => ({ target, borderBoxSize: [{ blockSize: height(target), inlineSize: width }] })));
            await new Promise((resolve) => setTimeout(resolve, 180));
        });
    };
    try {
        await settle(() => root.render(React.createElement(Provider, { store: state }, React.createElement(LogBox))));
        await waitForLayout();
        const container = document.getElementById("log_container");
        const mountedRows = container.querySelectorAll("[data-index]").length;
        assert.ok(mountedRows < 100, "history must not mount all 10000 messages");
        t.diagnostic(`10000-message history: ${mountedRows} rows mounted in simulated 600px viewport`);
        assert.match(container.textContent, /message 9999/);
        await settle(() => { container.dispatchEvent(new dom.window.Event("wheel")); container.scrollTo({ top: 0 }); });
        await waitForLayout();
        assert.match(container.textContent, /message 0/);
        const before = container.scrollTop;
        await settle(() => state.set(logs, (old) => ({ ...old, data: [...old.data, entry(10000)] })));
        assert.equal(container.scrollTop, before, "incoming speech must not pull a reader to the bottom");
        await waitForLayout();
        assert.match(container.textContent, /message 0/);
        await settle(() => { container.dispatchEvent(new dom.window.Event("wheel")); container.scrollTo({ top: 500000 }); });
        await waitForLayout();
        const firstVisibleIndex = () => [...container.querySelectorAll("[data-index]")].find((row) => {
            const top = parseFloat(row.style.transform.slice(11));
            return top + height(row) > container.scrollTop + 0.5;
        })?.dataset.index;
        const readingIndex = firstVisibleIndex();
        await settle(() => {
            width = 600;
            for (const observer of observers) observer.callback([...observer.targets].map((target) => ({ target, borderBoxSize: [{ blockSize: height(target), inlineSize: width }] })));
        });
        await waitForLayout();
        assert.equal(firstVisibleIndex(), readingIndex, "resizing while browsing must retain the visible message");
        await settle(() => state.set(scale, 150));
        await waitForLayout();
        assert.equal(firstVisibleIndex(), readingIndex, "font changes while browsing must retain the visible message");
        await settle(() => document.dispatchEvent(new dom.window.Event("vrcnt-fonts-changed")));
        await waitForLayout();
        assert.equal(firstVisibleIndex(), readingIndex, "asynchronous fonts must retain the visible message");
        await settle(() => shared.log_box_scroll_to_bottom());
        await waitForLayout();
        assert.match(container.textContent, /message 10000/);
        await settle(() => state.set(logs, (old) => ({ ...old, data: [...old.data, entry(10001)] })));
        await waitForLayout();
        assert.match(container.textContent, /message 10001/);
        await settle(() => {
            state.set(logs, (old) => ({ ...old, data: old.data.map((row) => row.id === "m10001" ? {
                ...row, messages: { ...row.messages, translations: [{ target_slot: "1", message: "expanded translation", transliteration: [] }] },
            } : row) }));
        });
        await settle(() => { for (const observer of observers) observer.callback([...observer.targets].map((target) => ({ target, borderBoxSize: [{ blockSize: height(target), inlineSize: 800 }] }))); });
        await waitForLayout();
        assert.match(container.textContent, /expanded translation/);
        assert.ok(Math.abs(container.scrollHeight - container.scrollTop - 600) < 5, "growing translations must stay pinned at the bottom");
        assert.equal(state.get(logs).data.length, 10002, "virtualizing must preserve full session history");
        await settle(() => state.set(scale, 200));
        await waitForLayout();
        assert.match(container.textContent, /message 10001/);
        assert.ok(Math.abs(container.scrollHeight - container.scrollTop - 600) < 5, "font changes must stay pinned");
        await settle(() => {
            width = 400;
            for (const observer of observers) observer.callback([...observer.targets].map((target) => ({ target, borderBoxSize: [{ blockSize: height(target), inlineSize: width }] })));
        });
        await waitForLayout();
        assert.ok(Math.abs(container.scrollHeight - container.scrollTop - 600) < 5, "window resizing must stay pinned");
        await settle(() => state.set(logs, { state: "ok", data: [] }));
        await waitForLayout();
        assert.match(container.textContent, /empty_title/);
        await settle(() => state.set(logs, { state: "ok", data: [entry(0)] }));
        await waitForLayout();
        assert.match(container.textContent, /message 0/);
        await settle(() => state.set(logs, (old) => ({ ...old, data: [...old.data, { ...entry(1), id: "bing-interim-mic", status: "interim" }] })));
        await waitForLayout();
        assert.match(container.textContent, /message 1/);
        await settle(() => state.set(logs, (old) => ({ ...old, data: [...old.data.filter((row) => row.id !== "bing-interim-mic"), entry(2)] })));
        await waitForLayout();
        assert.match(container.textContent, /message 2/);
        assert.doesNotMatch(container.textContent, /message 1\b/);
    } finally {
        await act(() => root.unmount());
        assert.equal(shared.log_box_ref, null);
        dom.window.close();
    }
});

test("message actions do not subscribe to history or input and retain send, edit, and retry behavior", async () => {
    const { useMessageActions } = load(path.resolve("src-ui/logics/common/useMessageActions.js"));
    const dom = new JSDOM("<div id='root'></div>");
    globalThis.window = dom.window; globalThis.document = dom.window.document;
    const state = createStore();
    let renders = 0, actions;
    const Probe = () => { renders++; actions = useMessageActions(); return null; };
    const root = createRoot(document.getElementById("root"));
    try {
        await act(() => root.render(React.createElement(Provider, { store: state }, React.createElement(Probe))));
        const before = renders;
        await act(() => { state.set(logs, { state: "ok", data: [] }); state.set(input, { state: "ok", data: "typing" }); });
        assert.equal(renders, before);
        await act(() => actions.updateMessageInputValue("edit this"));
        assert.equal(state.get(input).data, "edit this");
        await act(() => actions.sendMessage("resend this"));
        assert.equal(state.get(logs).data.at(-1).messages.original.message, "resend this");
        assert.deepEqual(backendCalls.at(-1), ["/run/send_message_box", { id: state.get(logs).data.at(-1).id, message: "resend this" }]);
        const payload = { trace_id: "trace", target_slot: "1" };
        actions.retryTranslation(payload);
        assert.deepEqual(backendCalls.at(-1), ["/run/retry_translation", payload]);
        assert.equal(renders, before);
    } finally { await act(() => root.unmount()); dom.window.close(); }
});
