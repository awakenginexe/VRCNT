import test from "node:test";
import assert from "node:assert/strict";

const api = () => import("../releaseUpdates.js");
const release = (version, extra = {}) => ({ tag_name: `v${version}`, name: version, body: `Changes for ${version}`,
    published_at: "2026-09-01T00:00:00Z", draft: false, prerelease: version.includes("-"),
    assets: [{ name: "latest.json", state: "uploaded" }, { name: `VRCNT_${version.split("-")[0]}_Setup.exe`, state: "uploaded" }], ...extra });

test("chooses the latest stable directly and retains every skipped stable release in semantic order", async () => {
    const { selectReleaseUpdates } = await api();
    const result = selectReleaseUpdates([release("5.15.0"), release("5.16.0"), release("5.14.0"), release("5.13.0"), release("6.0.0-rc.3")], "5.13.0");
    assert.equal(result.new_version, "5.16.0");
    assert.deepEqual(result.releases.map((r) => r.version), ["5.16.0", "5.15.0", "5.14.0"]);
    assert.equal(result.release_url, "https://github.com/awakenginexe/VRCNT/releases/tag/v5.16.0");
});
test("RC versions advance to later RCs or stable without suggesting downgrades", async () => {
    const { selectReleaseUpdates } = await api();
    const versions = [release("6.0.0-rc.1"), release("6.0.0-rc.3"), release("6.0.0-rc.2"), release("5.16.0")];
    assert.equal(selectReleaseUpdates(versions, "6.0.0-rc.2").new_version, "6.0.0-rc.3");
    assert.equal(selectReleaseUpdates([...versions, release("6.0.0")], "6.0.0-rc.2").new_version, "6.0.0");
    assert.equal(selectReleaseUpdates(versions, "6.0.0").is_update_available, false);
});
test("drafts, incomplete uploads, malformed tags and future RCs do not become stable update targets", async () => {
    const { selectReleaseUpdates } = await api();
    const result = selectReleaseUpdates([release("5.16.0", { draft: true }), release("5.15.0", { assets: [] }), release("6.0.0-rc.3"), release("5.14.0"), release("5.99.0", { tag_name: "../../attack" })], "5.13.0");
    assert.equal(result.new_version, "5.14.0");
    assert.deepEqual(result.releases.map((r) => r.version), ["5.14.0"]);
});
test("GitHub history is paginated rather than silently stopping at the first page", async () => {
    const { fetchReleaseHistory } = await api();
    const urls = [];
    const fetcher = async (url) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => urls.length === 1 ? Array.from({ length: 100 }, (_, i) => release(`5.${i}.0`)) : [release("4.0.0")], headers: { get: () => urls.length === 1 ? '<next>; rel="next"' : null } };
    };
    assert.equal((await fetchReleaseHistory(fetcher)).length, 101);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /per_page=100&page=2/);
    await assert.rejects(() => fetchReleaseHistory(async () => ({ ok: false, status: 403 })), /403/);
});
