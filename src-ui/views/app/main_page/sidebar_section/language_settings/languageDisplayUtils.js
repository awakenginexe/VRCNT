const COUNTRY_FLAG_CODES = {
    "albania": "al",
    "algeria": "dz",
    "argentina": "ar",
    "armenia": "am",
    "australia": "au",
    "austria": "at",
    "azerbaijan": "az",
    "bahrain": "bh",
    "bangladesh": "bd",
    "belgium": "be",
    "bolivia": "bo",
    "bosnia and herzegovina": "ba",
    "brazil": "br",
    "bulgaria": "bg",
    "cambodia": "kh",
    "canada": "ca",
    "chile": "cl",
    "china": "cn",
    "colombia": "co",
    "costa rica": "cr",
    "cote d'ivoire": "ci",
    "croatia": "hr",
    "czech republic": "cz",
    "czechia": "cz",
    "czech": "cz",
    "denmark": "dk",
    "dominican republic": "do",
    "ecuador": "ec",
    "egypt": "eg",
    "el salvador": "sv",
    "estonia": "ee",
    "ethiopia": "et",
    "finland": "fi",
    "france": "fr",
    "georgia": "ge",
    "germany": "de",
    "ghana": "gh",
    "greece": "gr",
    "guatemala": "gt",
    "honduras": "hn",
    "hong kong": "hk",
    "hungary": "hu",
    "iceland": "is",
    "india": "in",
    "indonesia": "id",
    "iran": "ir",
    "iraq": "iq",
    "ireland": "ie",
    "israel": "il",
    "italy": "it",
    "ivory coast": "ci",
    "japan": "jp",
    "jordan": "jo",
    "kazakhstan": "kz",
    "kenya": "ke",
    "korea": "kr",
    "republic of korea": "kr",
    "kuwait": "kw",
    "laos": "la",
    "latvia": "lv",
    "lebanon": "lb",
    "lithuania": "lt",
    "macau": "mo",
    "macao": "mo",
    "malaysia": "my",
    "mauritania": "mr",
    "mexico": "mx",
    "mongolia": "mn",
    "morocco": "ma",
    "myanmar": "mm",
    "nepal": "np",
    "netherlands": "nl",
    "new zealand": "nz",
    "nicaragua": "ni",
    "nigeria": "ng",
    "north macedonia": "mk",
    "norway": "no",
    "oman": "om",
    "pakistan": "pk",
    "palestine": "ps",
    "state of palestine": "ps",
    "panama": "pa",
    "paraguay": "py",
    "peru": "pe",
    "philippines": "ph",
    "poland": "pl",
    "portugal": "pt",
    "puerto rico": "pr",
    "qatar": "qa",
    "romania": "ro",
    "russia": "ru",
    "russian federation": "ru",
    "saudi arabia": "sa",
    "serbia": "rs",
    "singapore": "sg",
    "slovakia": "sk",
    "slovenia": "si",
    "south africa": "za",
    "south korea": "kr",
    "spain": "es",
    "sri lanka": "lk",
    "sweden": "se",
    "switzerland": "ch",
    "syria": "sy",
    "syrian arab republic": "sy",
    "taiwan": "tw",
    "tanzania": "tz",
    "thailand": "th",
    "tunisia": "tn",
    "turkey": "tr",
    "uae": "ae",
    "ukraine": "ua",
    "united arab emirates": "ae",
    "united kingdom": "gb",
    "uk": "gb",
    "united states": "us",
    "usa": "us",
    "uruguay": "uy",
    "uzbekistan": "uz",
    "venezuela": "ve",
    "vietnam": "vn",
    "viet nam": "vn",
    "yemen": "ye",
};

const FLAG_COUNTRY_CODES = new Set(Object.values(COUNTRY_FLAG_CODES));

// These SVGs exceed Vite's default inline threshold. With this worktree's
// shared node_modules junction, Vite would otherwise serve them through a
// blocked /@fs URL rather than a worktree-local asset URL.
export const LOCAL_FLAG_COUNTRY_CODES = new Set([
    "bo", "br", "do", "ec", "eg", "es", "gt", "hr", "ir", "kh",
    "kz", "lk", "mx", "ni", "om", "pt", "py", "rs", "sa", "sv",
]);

const normalizeCountryKey = (country) => country
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");

export const getCountryFlagCode = (country) => {
    if (typeof country !== "string") return "";
    const normalizedCountry = normalizeCountryKey(country);
    const mappedCode = COUNTRY_FLAG_CODES[normalizedCountry];
    if (mappedCode) return mappedCode;

    if (FLAG_COUNTRY_CODES.has(normalizedCountry)) return normalizedCountry;

    const localeRegionCode = country
        .trim()
        .split(/[-_]/)
        .at(-1)
        ?.toLowerCase();
    return FLAG_COUNTRY_CODES.has(localeRegionCode) ? localeRegionCode : "";
};

export const resolveFlagCountryCode = (languageEntry) => {
    const country = typeof languageEntry === "string"
        ? languageEntry
        : languageEntry?.country ?? languageEntry?.countryCode ?? languageEntry?.region;
    const countryCode = getCountryFlagCode(country);

    return countryCode === ""
        ? { kind: "fallback", countryCode: "" }
        : { kind: "flag", countryCode };
};

export const getLanguageDisplayLabel = ({ language, country }) => {
    return `${language} (${country})`;
};
