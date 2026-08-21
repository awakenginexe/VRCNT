import { useEffect, useRef, useState } from "react";
import { useI18n } from "@useI18n";

import { useAppearance } from "@logics_configs";
import {
    APP_COLOR_PALETTE_DEFAULTS,
    isColorResetMigrationRequired,
    useIsBackendReady,
} from "@logics_common";
import { isTauriRuntime } from "@logics_common/tauriRuntime.js";

import styles from "./ColorResetMigrationGate.module.scss";

export const ColorResetMigrationGate = () => {
    const { t } = useI18n();
    const { currentIsBackendReady } = useIsBackendReady();
    const {
        currentColorReset590,
        updateAppColorPalette,
        setAppColorPalette,
        setColorReset590,
    } = useAppearance();
    const [isResetting, setIsResetting] = useState(false);
    const [hasResetError, setHasResetError] = useState(false);
    const cardRef = useRef(null);
    const previousFocusRef = useRef(null);

    const isRequired = isColorResetMigrationRequired({
        isTauri: isTauriRuntime(),
        isBackendReady: currentIsBackendReady.data,
        flagValue: currentColorReset590.data,
        flagState: currentColorReset590.state,
        isSaving: isResetting,
    });

    useEffect(() => {
        if (!isRequired) return undefined;

        previousFocusRef.current = document.activeElement;
        cardRef.current?.focus();

        return () => {
            const previous = previousFocusRef.current;
            if (previous?.isConnected) previous.focus();
        };
    }, [isRequired]);

    useEffect(() => {
        if (!isResetting) return;

        if (currentColorReset590.data === 1) {
            setIsResetting(false);
            setHasResetError(false);
        } else if (currentColorReset590.state === "error") {
            setIsResetting(false);
            setHasResetError(true);
        }
    }, [currentColorReset590.data, currentColorReset590.state, isResetting]);

    const resetColorsAndContinue = () => {
        if (isResetting) return;

        const resetPalette = { ...APP_COLOR_PALETTE_DEFAULTS };
        setHasResetError(false);
        setIsResetting(true);
        updateAppColorPalette(resetPalette);
        setAppColorPalette(resetPalette);
        setColorReset590(1);
    };

    if (!isRequired) return null;

    const titleId = "color-reset-migration-title";
    const descriptionId = "color-reset-migration-description";

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
        >
            <section className={styles.card} ref={cardRef} tabIndex={-1}>
                <h2 className={styles.title} id={titleId}>
                    {t("config_page.appearance.colors.color_reset_migration.title")}
                </h2>
                <p className={styles.description} id={descriptionId}>
                    {t("config_page.appearance.colors.color_reset_migration.description")}
                </p>
                {hasResetError ? (
                    <p className={styles.error} role="alert">
                        {t("config_page.appearance.colors.color_reset_migration.error")}
                    </p>
                ) : null}
                <button
                    type="button"
                    className={styles.action}
                    onClick={resetColorsAndContinue}
                    disabled={isResetting}
                    aria-busy={isResetting}
                >
                    {isResetting
                        ? t("config_page.appearance.colors.color_reset_migration.saving")
                        : t("config_page.appearance.colors.color_reset_migration.action")}
                </button>
            </section>
        </div>
    );
};
