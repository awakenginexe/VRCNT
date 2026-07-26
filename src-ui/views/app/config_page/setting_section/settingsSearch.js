import { sidebarTabOrder } from "../sidebar_section/sidebarTabMeta.js";

const namespaceByTab = {
    device: "device",
    appearance: "appearance",
    model_and_provider: ["translation", "transcription"],
    vr: "vr",
    others: "others",
    hotkeys: "hotkeys",
    advanced_settings: "advanced_settings",
};

const flattenStrings = (value, path = [], output = []) => {
    if (typeof value === "string") {
        output.push({ path, value });
        return output;
    }

    if (!value || typeof value !== "object") return output;

    for (const [key, nestedValue] of Object.entries(value)) {
        flattenStrings(nestedValue, [...path, key], output);
    }
    return output;
};

const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase();
const nonControlKeyPattern = /(desc|description|success|failed|error|warning|notification|checking|connected|disconnected|template|notice)/i;

export const buildSettingsSearchResults = ({
    resourceBundle,
    query,
    tabMeta,
    limit = 48,
}) => {
    const normalizedQuery = normalize(query);
    if (normalizedQuery.length < 2) return [];

    const results = [];
    const seen = new Set();
    const configBundle = resourceBundle?.config_page ?? {};

    for (const tabId of sidebarTabOrder) {
        const meta = tabMeta[tabId];
        const namespaceValue = namespaceByTab[tabId];
        const namespaces = Array.isArray(namespaceValue)
            ? namespaceValue
            : namespaceValue
            ? [namespaceValue]
            : [];
        const leaves = namespaces.flatMap(
            (namespace) => flattenStrings(configBundle[namespace], [namespace]),
        );
        const candidates = [
            { value: meta?.label, path: ["section"] },
            { value: meta?.tooltipDetail, path: ["section", "description"] },
            ...leaves,
        ];

        for (const candidate of candidates) {
            const value = String(candidate.value ?? "").trim();
            if (candidate.path[0] !== "section" && candidate.path.some(
                (pathPart) => nonControlKeyPattern.test(pathPart),
            )) continue;
            if (value.length < 2 || value.length > 140) continue;
            if (!normalize(value).includes(normalizedQuery)) continue;

            const dedupeKey = `${tabId}:${normalize(value)}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            results.push({
                tabId,
                label: value,
                sectionLabel: meta?.label ?? tabId,
                path: candidate.path.join("."),
                startsWithQuery: normalize(value).startsWith(normalizedQuery),
            });
        }
    }

    return results
        .sort((left, right) => {
            if (left.startsWithQuery !== right.startsWithQuery) {
                return left.startsWithQuery ? -1 : 1;
            }
            return left.label.length - right.label.length;
        })
        .slice(0, limit);
};
