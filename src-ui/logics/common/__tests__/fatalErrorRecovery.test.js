import assert from "node:assert/strict";
import test from "node:test";

import * as tauriRuntime from "../tauriRuntime.js";

test("fatal error recovery closes the native window without backend shutdown", async () => {
    assert.equal(typeof tauriRuntime.closeWindowAfterFatalError, "function");
    let closeCount = 0;
    const appWindow = {
        close: async () => {
            closeCount += 1;
        },
    };

    const closed = await tauriRuntime.closeWindowAfterFatalError(appWindow);

    assert.equal(closed, true);
    assert.equal(closeCount, 1);
});

test("fatal error recovery is safe before a window handle exists", async () => {
    assert.equal(typeof tauriRuntime.closeWindowAfterFatalError, "function");
    assert.equal(await tauriRuntime.closeWindowAfterFatalError(undefined), false);
});
