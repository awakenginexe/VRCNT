import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("approved notifications remain dismissible, pause on hover, and preserve critical persistence", () => {
    const controller = readSource("../SnackbarController.jsx");
    const styles = readSource("../SnackbarController.module.scss");
    const overrideStyles = readSource("../ReactToastifyOverrideClass.scss");

    assert.match(controller, /position="bottom-left"/);
    assert.match(controller, /pauseOnHover=\{true\}/);
    assert.match(controller, /hide_duration === null[\s\S]*?hide_duration = false/);
    assert.match(controller, /hideProgressBar:\s*to_hide_progress_bar \|\| hide_duration === false/);
    assert.match(controller, /aria-label=\{t\("main_page\.notifications\.dismiss"\)\}/);
    assert.match(controller, /closeToast\(true\)/);
    assert.match(controller, /"--vrcnt-notification-duration": `\$\{hide_duration\}ms`/);
    assert.match(controller, /onClose:\s*\(\) =>\s*\{[\s\S]*?closeNotification\(\)/);

    assert.match(styles, /\.dismiss_button\s*\{[\s\S]*?position:\s*absolute/);
    assert.match(styles, /\.dismiss_button\s*\{[\s\S]*?inset-inline-end:/);
    assert.match(styles, /\.dismiss_button:focus-visible/);
    assert.match(styles, /vrcnt_notification_lifetime/);
    assert.match(overrideStyles, /Toastify__toast-container--bottom-left/);
    assert.match(overrideStyles, /prefers-reduced-motion/);
});

test("notification accessibility copy is localized for every supported UI language", () => {
    const localeFiles = [
        "../../../../../../locales/en.yml",
        "../../../../../../locales/ja.yml",
        "../../../../../../locales/ko.yml",
        "../../../../../../locales/th.yml",
        "../../../../../../locales/zh-Hans.yml",
        "../../../../../../locales/zh-Hant.yml",
    ];

    for (const localeFile of localeFiles) {
        const locale = readSource(localeFile);
        assert.match(locale, /main_page:[\s\S]*?notifications:[\s\S]*?label:/);
        assert.match(locale, /main_page:[\s\S]*?notifications:[\s\S]*?dismiss:/);
    }
});
