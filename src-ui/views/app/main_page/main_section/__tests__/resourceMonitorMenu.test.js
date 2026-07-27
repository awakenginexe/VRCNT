import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const requiredModuleUrl = new URL(
    "../resource_monitor/resourceMenuPosition.js",
    import.meta.url
);

const readRequiredSource = (path) => {
    const sourceUrl = new URL(path, import.meta.url);
    assert.ok(existsSync(fileURLToPath(sourceUrl)), `${path} must exist`);
    return readFileSync(sourceUrl, "utf8");
};

test("resource menus stay inside the viewport at the right and left edges", async () => {
    assert.ok(
        existsSync(fileURLToPath(requiredModuleUrl)),
        "resourceMenuPosition.js must exist"
    );
    const { calculateResourceMenuPosition } = await import(requiredModuleUrl);

    assert.deepEqual(calculateResourceMenuPosition(
        { left: 900, right: 1000, top: 40, bottom: 100, width: 100, height: 60 },
        { width: 240, height: 180 },
        { width: 1024, height: 768 },
        8
    ), { left: 776, top: 108 });

    assert.deepEqual(calculateResourceMenuPosition(
        { left: -24, right: 76, top: 120, bottom: 180, width: 100, height: 60 },
        { width: 240, height: 180 },
        { width: 1024, height: 768 },
        8
    ), { left: 8, top: 188 });
});

test("resource menus flip above their card when there is not enough room below", async () => {
    assert.ok(
        existsSync(fileURLToPath(requiredModuleUrl)),
        "resourceMenuPosition.js must exist"
    );
    const { calculateResourceMenuPosition } = await import(requiredModuleUrl);

    assert.deepEqual(calculateResourceMenuPosition(
        { left: 300, right: 500, top: 620, bottom: 680, width: 200, height: 60 },
        { width: 240, height: 180 },
        { width: 1024, height: 768 },
        8
    ), { left: 300, top: 432 });
});

test("the GPU selector is body-portalled and closes through every interaction path", () => {
    const menu = readRequiredSource("../resource_monitor/GpuMonitorMenu.jsx");
    const monitor = readRequiredSource("../resource_monitor/ResourceMonitor.jsx");

    assert.match(menu, /import\s+\{\s*createPortal\s*\}\s+from\s+"react-dom"/);
    assert.match(menu, /return\s+createPortal\([\s\S]*document\.body/);
    assert.match(menu, /event\.key\s*===\s*"Escape"[\s\S]*onClose\(\)/);
    assert.match(menu, /menuRef\.current\?\.contains\(event\.target\)/);
    assert.match(menu, /anchorElement\?\.contains\(event\.target\)/);
    assert.match(menu, /document\.addEventListener\("pointerdown",\s*handlePointerDown\)/);
    assert.match(menu, /document\.removeEventListener\("pointerdown",\s*handlePointerDown\)/);
    assert.match(menu, /document\.addEventListener\("keydown",\s*handleKeyDown\)/);
    assert.match(menu, /document\.removeEventListener\("keydown",\s*handleKeyDown\)/);
    assert.match(menu, /window\.addEventListener\("resize",\s*updatePosition\)/);
    assert.match(menu, /window\.removeEventListener\("resize",\s*updatePosition\)/);
    assert.match(menu, /window\.addEventListener\("scroll",\s*updatePosition,\s*true\)/);
    assert.match(menu, /window\.removeEventListener\("scroll",\s*updatePosition,\s*true\)/);

    assert.match(monitor, /setGpuMonitorSelection\(selection\)[\s\S]*closeGpuMenu\(\)/);
});

test("the first menu layout uses the DOM card captured by its click event", () => {
    const menu = readRequiredSource("../resource_monitor/GpuMonitorMenu.jsx");
    const monitor = readRequiredSource("../resource_monitor/ResourceMonitor.jsx");

    assert.match(monitor, /const\s+\[openGpuMenu,\s*setOpenGpuMenu\]\s*=\s*useState\(null\)/);
    assert.match(monitor, /const\s+closeGpuMenu\s*=\s*useCallback\(/);
    assert.match(
        monitor,
        /onToggleGpuMenu=\{\(event\)\s*=>\s*toggleGpuMenu\(item\.key,\s*event\.currentTarget\)\}/
    );
    assert.match(
        monitor,
        /current\?\.cardKey\s*===\s*cardKey\s*\?\s*null\s*:\s*\{\s*cardKey,\s*anchorElement\s*\}/
    );
    assert.match(monitor, /anchorElement=\{openGpuMenu\?\.anchorElement\}/);
    assert.doesNotMatch(monitor, /activeGpuCardRef|anchorRef/);

    assert.match(menu, /anchorElement\.getBoundingClientRect\(\)/);
    assert.match(menu, /\[anchorElement,\s*onClose\]/);
    assert.doesNotMatch(menu, /anchorRef/);
});
