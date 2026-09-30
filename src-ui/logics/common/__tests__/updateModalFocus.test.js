import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import Babel from "@babel/standalone";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

test("update modal traps keyboard focus, restores it, and ignores Escape/backdrop during installation", async () => {
    let opened = "update_software", busy = false;
    const closed = [];
    const UpdateModal = ({ onUpdateActivityChange }) => {
        React.useEffect(() => onUpdateActivityChange(busy), [busy, onUpdateActivityChange]);
        return React.createElement("div", null, React.createElement("h2", { id: "update-dialog-title" }, "Update"), React.createElement("button", null, "First"), React.createElement("button", null, "Last"));
    };
    const modules = {
        react: React,
        "./ModalController.module.scss": { wrapper: "wrapper", bg_onclick_close_area: "backdrop" },
        "@store": { useStore_OpenedQuickSetting: () => ({ currentOpenedQuickSetting: { data: opened }, updateOpenedQuickSetting: (value) => { closed.push(value); opened = value; } }) },
        "@setting_box": {},
        "../../config_page/setting_section/setting_box/others/Others": {},
        "../../config_page/setting_section/setting_box/others/startWithVrchatSettingsState.js": { dismissStartWithVrchatConfirmation: ({ isSaving, closeModal }) => { if (!isSaving) closeModal(); } },
        "./update_modal/UpdateModal": { UpdateModal },
    };
    const module = { exports: {} };
    const file = "src-ui/views/app/others/modal_controller/ModalController.jsx";
    const source = Babel.transform(fs.readFileSync(file, "utf8"), { presets: ["react"], plugins: ["transform-modules-commonjs"] }).code;
    vm.runInThisContext(`(function(React,require,module,exports){${source}\n})`)(React, (name) => modules[name], module, module.exports);
    const dom = new JSDOM("<button id='trigger'>Updates</button><div id='root'></div>");
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const trigger = document.getElementById("trigger"); trigger.focus();
    const root = createRoot(document.getElementById("root"));
    const render = () => act(() => root.render(React.createElement(module.exports.ModalController)));
    const key = (key, shiftKey = false) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
    try {
        await render();
        const buttons = document.querySelectorAll("#root button");
        assert.equal(document.activeElement.getAttribute("role"), "dialog");
        key("Tab"); assert.equal(document.activeElement, buttons[0]);
        key("Tab", true); assert.equal(document.activeElement, buttons[1]);
        key("Tab"); assert.equal(document.activeElement, buttons[0]);
        trigger.focus(); assert.equal(document.activeElement.getAttribute("role"), "dialog");
        busy = true; await render();
        key("Escape"); document.querySelector(".backdrop").click();
        assert.deepEqual(closed, []);
        busy = false; await render();
        key("Escape"); await render();
        assert.deepEqual(closed, [""]);
        assert.equal(document.activeElement, trigger);
    } finally { await act(() => root.unmount()); dom.window.close(); }
});
