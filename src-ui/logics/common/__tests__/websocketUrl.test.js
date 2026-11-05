import test from "node:test";
import assert from "node:assert/strict";
import { authenticatedWebsocketUrl } from "../websocketUrl.js";

test("authenticated URLs preserve tokens without injecting query parameters", () => {
    const token = "secret&extra=value+#";
    const url = new URL(authenticatedWebsocketUrl("127.0.0.1", 2231, token));
    assert.equal(url.searchParams.get("token"), token);
    assert.equal([...url.searchParams].length, 1);
});

test("IPv6 authenticated URLs bracket the host", () => {
    const url = new URL(authenticatedWebsocketUrl("::1", 2231, "secret"));
    assert.equal(url.hostname, "[::1]");
    assert.equal(url.port, "2231");
});
