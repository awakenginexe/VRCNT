import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@useI18n";
import { useProviderCooldowns } from "@logics_common";
import styles from "./ProviderCooldowns.module.scss";

export const ProviderCooldowns = () => {
    const { t } = useI18n();
    const cooldowns = useProviderCooldowns();
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (Object.keys(cooldowns).length === 0) return undefined;
        const timer = setInterval(() => setNowMs(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, [cooldowns]);

    const active = useMemo(() => Object.entries(cooldowns)
        .map(([provider, value]) => ({
            provider,
            reason: value?.reason,
            seconds: Math.max(
                0,
                Math.ceil((Number(value?.retry_at_ms) - nowMs) / 1_000),
            ),
        }))
        .filter((item) => item.seconds > 0), [cooldowns, nowMs]);

    if (active.length === 0) return null;
    return (
        <aside className={styles.container} aria-live="polite">
            {active.map((item) => (
                <div className={styles.item} key={item.provider}>
                    <span className={styles.dot} aria-hidden="true" />
                    <span>
                        {t("main_page.translation_cooldown.retry_in", {
                            engine: item.provider,
                            seconds: item.seconds,
                        })}
                    </span>
                </div>
            ))}
        </aside>
    );
};
