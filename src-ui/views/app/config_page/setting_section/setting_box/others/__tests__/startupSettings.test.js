import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../../../../../../");
const readSource = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("Others exposes startup controls and routes Start with VRChat confirmation through the shared modal", () => {
    const others = readSource("src-ui/views/app/config_page/setting_section/setting_box/others/Others.jsx");
    const modalController = readSource("src-ui/views/app/others/modal_controller/ModalController.jsx");

    assert.match(others, /QuickWakeUpContainer/);
    assert.match(others, /StartWithVrchatContainer/);
    assert.match(modalController, /case "start_with_vrchat"/);
});
