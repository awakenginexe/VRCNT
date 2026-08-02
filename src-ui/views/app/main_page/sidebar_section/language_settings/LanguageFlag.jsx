import clsx from "clsx";
import { useState } from "react";

import styles from "./LanguageFlag.module.scss";
import { resolveFlagCountryCode } from "./languageDisplayUtils.js";
import { LOCAL_FLAG_ASSET_URLS } from "./localFlagAssetUrls.js";

export const LanguageFlag = ({ country, className }) => {
    const { kind, countryCode } = resolveFlagCountryCode({ country });
    const localFlagAssetUrl = LOCAL_FLAG_ASSET_URLS[countryCode];
    const [failedAssetUrl, setFailedAssetUrl] = useState(null);
    const hasAssetError = failedAssetUrl === localFlagAssetUrl;
    const flagLabel = country ? `Flag of ${country}` : "Country flag unavailable";

    if (kind === "fallback" || hasAssetError) {
        return (
            <span
                className={clsx(styles.flag_shell, styles.fallback, className)}
                title={country || undefined}
                role="img"
                aria-label={country ? `Flag unavailable for ${country}` : flagLabel}
            >
                <span className={styles.globe_mark} aria-hidden="true" />
            </span>
        );
    }

    if (localFlagAssetUrl) {
        return (
            <span className={clsx(styles.flag_shell, className)} title={country}>
                <img
                    className={styles.flag_image}
                    src={localFlagAssetUrl}
                    alt={flagLabel}
                    onError={() => setFailedAssetUrl(localFlagAssetUrl)}
                />
            </span>
        );
    }

    return (
        <span
            className={clsx(styles.flag_shell, className)}
            title={country}
            role="img"
            aria-label={flagLabel}
        >
            <span className={clsx("fi", `fi-${countryCode}`, styles.flag_icon)} />
        </span>
    );
};
