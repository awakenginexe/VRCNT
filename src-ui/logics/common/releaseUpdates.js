import semver from "semver";

export const RELEASES_API = "https://api.github.com/repos/awakenginexe/VRCNT/releases";
const RELEASES_ROOT = "https://github.com/awakenginexe/VRCNT/releases";
export const normalizeReleaseVersion = (tag) => {
    if (typeof tag !== "string" || !/^v?\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(tag)) return null;
    return semver.valid(tag.replace(/^v/, ""));
};

export const selectReleaseUpdates = (history, installedVersion) => {
    const installed = normalizeReleaseVersion(installedVersion);
    if (!installed) throw new Error("Installed release version is unavailable.");
    const includeRC = semver.prerelease(installed) != null;
    const versions = new Map();
    for (const release of history) {
        const version = normalizeReleaseVersion(release?.tag_name);
        if (!version || release.draft || !release.published_at) continue;
        if (!includeRC && (release.prerelease || semver.prerelease(version))) continue;
        if (!semver.gt(version, installed)) continue;
        versions.set(version, { release, version });
    }
    const newer = [...versions.values()].sort((a, b) => semver.rcompare(a.version, b.version));
    const target = newer.find(({ release, version }) => {
        const core = `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}`;
        const assets = new Set((release.assets ?? []).filter((asset) => asset.state === "uploaded").map((asset) => asset.name));
        return assets.has("latest.json") && assets.has(`VRCNT_${core}_Setup.exe`);
    });
    return {
        installed_version: installed,
        is_update_available: Boolean(target),
        new_version: target?.version ?? installed,
        release_url: target ? `${RELEASES_ROOT}/tag/${target.release.tag_name}` : RELEASES_ROOT,
        catalog_checked: true,
        notes_complete: true,
        releases: target ? newer.filter(({ version }) => semver.lte(version, target.version)).map(({ release, version }) => ({
            tag: release.tag_name, version, name: release.name || version,
            published_at: release.published_at, body: typeof release.body === "string" ? release.body : "",
            url: `${RELEASES_ROOT}/tag/${release.tag_name}`,
        })) : [],
    };
};

export const fetchReleaseHistory = async (fetcher, signal) => {
    const history = [];
    for (let page = 1; ; page++) {
        const response = await fetcher(`${RELEASES_API}?per_page=100&page=${page}`, {
            headers: { Accept: "application/vnd.github+json" }, signal,
        });
        if (!response.ok) throw new Error(`Release notes request failed (${response.status}).`);
        const releases = await response.json();
        if (!Array.isArray(releases)) throw new Error("Invalid release history response.");
        history.push(...releases);
        if (!releases.length || !response.headers?.get("link")?.includes('rel="next"')) return history;
    }
};
