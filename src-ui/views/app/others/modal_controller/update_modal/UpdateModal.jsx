import { useEffect } from "react";
import ReactMarkdown from "react-markdown";

import { useI18n } from "@useI18n";
import { useStore_OpenedQuickSetting } from "@store";
import { useUpdateSoftware } from "@logics_common";
import { useReleaseUpdates } from "@logics_common/useReleaseUpdates.js";
import styles from "./UpdateModal.module.scss";

const isInstallActive = (status) => ["checking", "downloading", "restarting"].includes(status);

const safeHttpUrl = (value) => {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
};

const MarkdownImage = () => null;

const MarkdownLink = ({ href, children }) => {
    const safeHref = safeHttpUrl(href);
    if (!safeHref) return <span>{children}</span>;
    return <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a>;
};

export const UpdateDialog = ({
    info = {},
    status = "ready",
    error = null,
    updateState = { status: "idle", progress: 0, message: "", is_indeterminate: false },
    onUpdate = () => {},
    onRefresh = () => {},
    onRelease = () => {},
    onClose = () => {},
    isPreview = false,
}) => {
    const { t } = useI18n();
    const busy = isInstallActive(updateState.status);
    const updateAvailable = info.is_update_available === true;
    const latestVersion = updateState.version || info.new_version || "";
    // The catalog already orders notes by semantic version, including RCs.
    const releases = Array.isArray(info.releases) ? info.releases : [];
    const hasCatalogError = status === "error";
    const isCatalogLoading = status === "loading";
    const isConfirmedLatest = status === "ready" && info.catalog_checked && !updateAvailable;
    const showProgress = busy;
    const progress = Math.min(100, Math.max(0, Math.round((updateState.progress ?? 0) * 100)));

    return (
        <section className={styles.dialog} aria-labelledby="update-dialog-title">
            <header className={styles.header}>
                <div className={styles.heading_group}>
                    <p className={styles.eyebrow}>{t("update_modal.eyebrow")}</p>
                    <h2 id="update-dialog-title" className={styles.title}>{t("update_modal.title")}</h2>
                    <div className={styles.version_line} aria-label={t("update_modal.version_transition", {
                        installed: info.installed_version || t("update_modal.unknown_version"),
                        latest: info.new_version || info.installed_version || t("update_modal.unknown_version"),
                    })}>
                        <span className={styles.version}>{info.installed_version || t("update_modal.unknown_version")}</span>
                        <span className={styles.version_arrow} aria-hidden="true">→</span>
                        <span className={styles.version}>{info.new_version || info.installed_version || t("update_modal.unknown_version")}</span>
                        {updateAvailable ? <span className={styles.update_badge}>{t("update_modal.available")}</span> : null}
                    </div>
                </div>
                <button
                    type="button"
                    className={styles.close_button}
                    onClick={onClose}
                    disabled={busy}
                    aria-label={t("update_modal.close_modal")}
                >
                    <span aria-hidden="true">×</span>
                </button>
            </header>

            {isPreview ? <p className={styles.preview_notice}>{t("update_modal.preview_notice")}</p> : null}

            <div className={styles.content}>
                {updateAvailable ? (
                    <p className={styles.summary}>{t("update_modal.release_notes_intro", { version: info.new_version })}</p>
                ) : (
                    <p className={styles.summary}>{t(isConfirmedLatest ? "update_modal.is_latest_version_already" : hasCatalogError ? "update_modal.notes_unavailable" : "update_modal.loading_notes")}</p>
                )}

                {showProgress ? (
                    <div className={styles.progress_panel} role="status" aria-live="polite">
                        <div className={styles.progress_heading}>
                            <span>{t(`update_modal.${updateState.status}`)}</span>
                            {!updateState.is_indeterminate ? <span>{progress}%</span> : null}
                        </div>
                        <div
                            className={styles.progress_track}
                            role="progressbar"
                            aria-label={t("update_modal.progress_label")}
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={updateState.is_indeterminate ? undefined : progress}
                        >
                            <span
                                className={`${styles.progress_fill}${updateState.is_indeterminate ? ` ${styles.is_indeterminate}` : ""}`}
                                style={updateState.is_indeterminate ? undefined : { width: `${progress}%` }}
                            />
                        </div>
                        {updateState.message ? <p>{updateState.message}</p> : null}
                    </div>
                ) : null}

                {updateState.status === "error" ? (
                    <div className={styles.error_panel} role="alert">
                        <p>{updateState.message || t("update_modal.install_error")}</p>
                        <div className={styles.inline_actions}>
                            <button type="button" className={styles.text_button} onClick={onUpdate}>
                                {t("update_modal.retry")}
                            </button>
                            <button type="button" className={styles.text_button} onClick={onRelease}>
                                {t("update_modal.open_releases")}
                            </button>
                        </div>
                    </div>
                ) : null}

                <div className={styles.release_header}>
                    <h3>{t("update_modal.release_notes")}</h3>
                    {hasCatalogError || !info.notes_complete ? (
                        <button type="button" className={styles.text_button} onClick={onRefresh} disabled={isCatalogLoading || busy}>
                            {t("update_modal.retry")}
                        </button>
                    ) : null}
                </div>

                {isCatalogLoading && releases.length === 0 ? (
                    <p className={styles.empty_state} role="status">{t("update_modal.loading_notes")}</p>
                ) : null}
                {hasCatalogError && releases.length === 0 ? (
                    <div className={styles.empty_state} role="status">
                        <p>{t("update_modal.notes_unavailable")}</p>
                        {safeHttpUrl(info.release_url) ? (
                            <button type="button" className={styles.text_button} onClick={() => onRelease(info.release_url)}>
                                {t("update_modal.open_releases")}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {!isCatalogLoading && releases.length === 0 && !hasCatalogError ? (
                    <p className={styles.empty_state}>{t("update_modal.no_release_notes")}</p>
                ) : null}

                {releases.length > 0 ? (
                    <div className={styles.release_list}>
                        {releases.map((release, index) => (
                            <article className={styles.release} key={`${release.tag || release.version || "release"}-${index}`}>
                                <div className={styles.release_heading}>
                                    <div>
                                        <h4>{release.name || release.tag || release.version}</h4>
                                        {release.version || release.tag ? (
                                            <span className={styles.release_version}>{release.version || release.tag}</span>
                                        ) : null}
                                    </div>
                                    <time dateTime={release.published_at || undefined}>
                                        {release.published_at
                                            ? new Date(release.published_at).toLocaleDateString()
                                            : t("update_modal.release_date_unknown")}
                                    </time>
                                </div>
                                {release.body ? (
                                    <div className={styles.markdown}>
                                        <ReactMarkdown
                                            skipHtml
                                            components={{ img: MarkdownImage, a: MarkdownLink }}
                                        >
                                            {release.body}
                                        </ReactMarkdown>
                                    </div>
                                ) : <p className={styles.empty_state}>{t("update_modal.notes_unavailable")}</p>}
                                {safeHttpUrl(release.url) ? (
                                    <button type="button" className={styles.release_link} onClick={() => onRelease(release.url)}>
                                        {t("update_modal.view_release")}
                                    </button>
                                ) : null}
                            </article>
                        ))}
                    </div>
                ) : null}
                {info.catalog_checked && !info.notes_complete && !hasCatalogError ? (
                    <p className={styles.partial_notice}>{t("update_modal.notes_incomplete")}</p>
                ) : null}
            </div>

            <footer className={styles.footer}>
                <button type="button" className={styles.later_button} onClick={onClose} disabled={busy}>
                    {t("update_modal.later")}
                </button>
                <button
                    type="button"
                    className={styles.update_button}
                    onClick={updateAvailable ? onUpdate : onRefresh}
                    disabled={busy || isCatalogLoading}
                >
                    {busy
                        ? t(`update_modal.${updateState.status}`)
                        : updateState.status === "error"
                            ? t("update_modal.retry")
                            : updateAvailable
                                ? info.new_version
                                    ? t("update_modal.update_to_version", { version: info.new_version })
                                    : t("update_modal.download_latest_button")
                                : t(isConfirmedLatest ? "update_modal.up_to_date" : hasCatalogError ? "update_modal.retry" : "update_modal.check_for_updates")}
                </button>
            </footer>
        </section>
    );
};

export const UpdateModal = ({ onUpdateActivityChange = () => {} }) => {
    const { updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const { updateSoftware, openReleaseFallback, updateState } = useUpdateSoftware();
    const { info, status, error, refresh } = useReleaseUpdates();

    useEffect(() => {
        onUpdateActivityChange(isInstallActive(updateState.status));
    }, [onUpdateActivityChange, updateState.status]);

    const openRelease = (url) => { void openReleaseFallback(url); };

    return (
        <UpdateDialog
            info={info}
            status={status}
            error={error}
            updateState={updateState}
            onUpdate={updateSoftware}
            onRefresh={refresh}
            onRelease={openRelease}
            onClose={() => updateOpenedQuickSetting("")}
        />
    );
};
