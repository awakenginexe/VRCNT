import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    captureOnboardingWindowGeometry,
    restoreOnboardingWindowGeometry,
} from "../onboardingWindowGeometry.js";

const createWindow = ({
    position = { x: 120, y: 80 },
    size = { width: 1498, height: 900 },
    maximized = false,
} = {}) => {
    let isMaximized = maximized;
    const calls = [];

    return {
        calls,
        getState: () => ({ position, size, isMaximized }),
        window: {
            async outerPosition() {
                return position;
            },
            async outerSize() {
                return size;
            },
            async isMaximized() {
                calls.push("isMaximized");
                return isMaximized;
            },
            async unmaximize() {
                calls.push("unmaximize");
                isMaximized = false;
            },
            async maximize() {
                calls.push("maximize");
                isMaximized = true;
            },
            async setSize(nextSize) {
                calls.push(["setSize", nextSize]);
                size = nextSize;
            },
            async setPosition(nextPosition) {
                calls.push(["setPosition", nextPosition]);
                position = nextPosition;
            },
        },
    };
};

test("the product tour snapshots the exact normal window bounds before it starts", async () => {
    const appWindow = createWindow({
        position: { x: 445, y: 45 },
        size: { width: 1474, height: 701 },
    }).window;

    assert.deepEqual(
        await captureOnboardingWindowGeometry(appWindow),
        {
            x_pos: 445,
            y_pos: 45,
            width: 1474,
            height: 701,
            maximized: false,
        },
    );
});

test("finishing the tour leaves full screen before restoring the saved size and position", async () => {
    const fixture = createWindow({ maximized: true });

    const restored = await restoreOnboardingWindowGeometry({
        appWindow: fixture.window,
        geometry: {
            x_pos: 445,
            y_pos: 45,
            width: 1474,
            height: 701,
            maximized: false,
        },
        createPhysicalPosition: (x, y) => ({ x, y }),
        createPhysicalSize: (width, height) => ({ width, height }),
    });

    assert.equal(restored, true);
    assert.deepEqual(fixture.getState(), {
        position: { x: 445, y: 45 },
        size: { width: 1474, height: 701 },
        isMaximized: false,
    });
});

test("finishing the tour waits for Windows to leave maximized state before applying normal bounds", async () => {
    let isMaximized = true;
    let appliedSize = null;
    let appliedPosition = null;
    const appWindow = {
        async isMaximized() {
            return isMaximized;
        },
        async unmaximize() {
            // Windows can acknowledge the command before its native window
            // message has changed the actual maximize state.
            setTimeout(() => {
                isMaximized = false;
            }, 0);
        },
        async setSize(size) {
            if (!isMaximized) appliedSize = size;
        },
        async setPosition(position) {
            if (!isMaximized) appliedPosition = position;
        },
    };

    const restored = await restoreOnboardingWindowGeometry({
        appWindow,
        geometry: {
            x_pos: 445,
            y_pos: 45,
            width: 1474,
            height: 701,
            maximized: false,
        },
        createPhysicalPosition: (x, y) => ({ x, y }),
        createPhysicalSize: (width, height) => ({ width, height }),
    });

    assert.equal(restored, true);
    assert.equal(isMaximized, false);
    assert.deepEqual(appliedSize, { width: 1474, height: 701 });
    assert.deepEqual(appliedPosition, { x: 445, y: 45 });
});

test("finishing the tour restores a maximized window when that was its original state", async () => {
    const fixture = createWindow({ maximized: false });

    const restored = await restoreOnboardingWindowGeometry({
        appWindow: fixture.window,
        geometry: {
            x_pos: 120,
            y_pos: 80,
            width: 1498,
            height: 900,
            maximized: true,
        },
        createPhysicalPosition: (x, y) => ({ x, y }),
        createPhysicalSize: (width, height) => ({ width, height }),
    });

    assert.equal(restored, true);
    assert.equal(fixture.getState().isMaximized, true);
});

test("saved main-window geometry includes maximized state and restores it on startup", () => {
    const source = readFileSync(
        new URL("../useWindow.js", import.meta.url),
        "utf8",
    );

    assert.match(source, /const maximized = await appWindow\.isMaximized\(\);/);
    assert.match(source, /maximized: maximized === true/);
    assert.match(
        source,
        /if \(maximized === true\) \{[\s\S]*?await appWindow\.maximize\(\);[\s\S]*?return;/,
    );
});
