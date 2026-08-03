import clsx from "clsx";
import { useEffect, useState } from "react";
import { CircularProgress } from "@common_components";
import { useI18n } from "@useI18n";
import { useDeepSeekConfiguration } from "@logics_common";
import { _Entry } from "../_atoms/_entry/_Entry";
import styles from "./AuthKey.module.scss";

const statusLabelKey = (health) => `config_page.translation.deepseek_auth_key.status_${health}`;

export const DeepSeekAuthKey = () => {
    const { t } = useI18n();
    const [inputValue, setInputValue] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const {
        currentDeepSeekAuthStatus,
        saveKey,
        deleteKey,
        testConnection,
    } = useDeepSeekConfiguration();

    const status = currentDeepSeekAuthStatus.data;
    const isPending = currentDeepSeekAuthStatus.state === "pending";

    useEffect(() => {
        if (isSaving && !isPending) {
            if (status.configured && status.health === "configured") {
                setInputValue("");
            }
            setIsSaving(false);
        }
    }, [isPending, isSaving, status.configured, status.health]);

    const save = async () => {
        setIsSaving(true);
        const result = await saveKey(inputValue);
        if (!result.ok) setIsSaving(false);
    };

    const saveButtonClassName = clsx(styles.save_button, {
        [styles.is_disabled]: isPending || !inputValue.trim(),
    });

    return (
        <div className={styles.container}>
            <div className={styles.entry_section_wrapper}>
                <_Entry
                    width="24rem"
                    type="password"
                    placeholder={t("config_page.translation.deepseek_auth_key.placeholder")}
                    ui_variable={inputValue}
                    is_disabled={isPending}
                    onChange={(event) => setInputValue(event.target.value)}
                />
                <button className={saveButtonClassName} onClick={save} disabled={isPending || !inputValue.trim()}>
                    {isPending
                        ? <CircularProgress size="1.4rem" sx={{ color: "var(--dark_basic_text_color)" }} />
                        : <p className={styles.save_button_label}>{t("config_page.translation.deepseek_auth_key.save")}</p>
                    }
                </button>
                <button className={styles.secondary_button} onClick={deleteKey} disabled={isPending || !status.configured}>
                    {t("config_page.translation.deepseek_auth_key.remove")}
                </button>
            </div>
            <div className={styles.connection_row}>
                <p className={styles.status_label}>{t(statusLabelKey(status.health))}</p>
                <button className={styles.secondary_button} onClick={testConnection} disabled={isPending || !status.configured}>
                    {t("config_page.translation.deepseek_auth_key.test_connection")}
                </button>
            </div>
        </div>
    );
};
