import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import Babel from "@babel/standalone";

const module = { exports: {} };
const filename = "src-ui/views/app/others/modal_controller/update_modal/UpdateModal.jsx";
const source = Babel.transform(fs.readFileSync(filename, "utf8"), { presets: ["react"], plugins: ["transform-modules-commonjs"] }).code;
const modules = {
    react: React, "react-markdown": ReactMarkdown,
    "@useI18n": { useI18n: () => ({ t: (key) => key }) },
    "@store": {}, "@logics_common": {}, "@logics_common/useReleaseUpdates.js": {},
    "./UpdateModal.module.scss": new Proxy({}, { get: (_, key) => key }),
};
vm.runInThisContext(`(function(React,require,module,exports){${source}\n})`, { filename })(React, (name) => modules[name], module, module.exports);
const render = (props) => renderToStaticMarkup(React.createElement(module.exports.UpdateDialog, props));

test("release notes retain semantic order even when maintenance versions publish later", () => {
    const html = render({ info: { is_update_available: true, releases: [
        { version: "6.0.0", name: "VRCNT 6.0.0", published_at: "2026-09-01" },
        { version: "5.16.0", name: "VRCNT 5.16.0", published_at: "2026-09-20" },
    ] } });
    assert.ok(html.indexOf("VRCNT 6.0.0") < html.indexOf("VRCNT 5.16.0"));
});

test("a failed or pending catalog never claims the app is already latest", () => {
    for (const status of ["idle", "loading", "error"]) {
        const html = render({ info: {}, status, error: "Offline" });
        assert.doesNotMatch(html, /update_modal.is_latest_version_already/);
        assert.doesNotMatch(html, /update_modal.up_to_date/);
    }
});

test("release markdown suppresses HTML, images and unsafe links while retaining safe links", () => {
    const html = render({ info: { releases: [{ version: "6.0.0", body: '<script>alert(1)</script>\n\n![tracking](https://evil.test/img)\n\n[unsafe](javascript:alert(1)) [safe](https://github.com/awakenginexe/VRCNT)' }] } });
    assert.doesNotMatch(html, /<script|<img|href="javascript:/);
    assert.match(html, /href="https:\/\/github.com\/awakenginexe\/VRCNT" target="_blank" rel="noopener noreferrer"/);
});
