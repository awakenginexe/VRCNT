import React, { useRef, useLayoutEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import styles from "./LogBox.module.scss";
import { MessageContainer } from "./message_container/MessageContainer";
import { useStore_MessageLogs, store } from "@store";
import { useAppearance } from "@logics_configs";
import { useI18n } from "@useI18n";

export const LogBox = () => {
    const { t } = useI18n();
    const { currentMessageLogs } = useStore_MessageLogs();
    const { currentMessageLogUiScaling } = useAppearance();
    const messages = currentMessageLogs.data;
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const logContainerRef = useRef(null);
    const visibleMessageRef = useRef(null);
    const getItemKey = useCallback((index) => messages[index].id, [messages]);
    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => logContainerRef.current,
        getItemKey,
        estimateSize: () => 120,
        overscan: 5,
        anchorTo: "end",
        followOnAppend: true,
        scrollEndThreshold: 5,
    });

    // Cached heights of offscreen rows also become stale when wrapping changes.
    useLayoutEffect(() => {
        const element = logContainerRef.current;
        let width = element.getBoundingClientRect().width;
        const remeasure = () => {
            const atEnd = virtualizer.isAtEnd();
            const anchorIndex = messagesRef.current.findIndex((message) => message.id === visibleMessageRef.current);
            virtualizer.measure();
            // Rebuild positions before scrolling to the retained message.
            virtualizer.getTotalSize();
            if (atEnd) virtualizer.scrollToEnd();
            else if (anchorIndex >= 0) virtualizer.scrollToIndex(anchorIndex, { align: "start" });
        };
        remeasure();
        const observer = new ResizeObserver(() => {
            const nextWidth = element.getBoundingClientRect().width;
            if (nextWidth !== width) {
                width = nextWidth;
                remeasure();
            }
        });
        observer.observe(element);
        document.fonts?.addEventListener("loadingdone", remeasure);
        document.addEventListener("vrcnt-fonts-changed", remeasure);
        const readFontFamily = () => element.ownerDocument.defaultView.getComputedStyle(element).fontFamily;
        let fontFamily = readFontFamily();
        const fontObserver = new MutationObserver(() => {
            const nextFontFamily = readFontFamily();
            if (nextFontFamily !== fontFamily) {
                fontFamily = nextFontFamily;
                remeasure();
            }
        });
        fontObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
        return () => {
            observer.disconnect();
            fontObserver.disconnect();
            document.fonts?.removeEventListener("loadingdone", remeasure);
            document.removeEventListener("vrcnt-fonts-changed", remeasure);
        };
    }, [virtualizer, currentMessageLogUiScaling.data]);

    useLayoutEffect(() => {
        store.log_box_ref = logContainerRef;
        const scrollToBottom = () => virtualizer.scrollToEnd();
        store.log_box_scroll_to_bottom = scrollToBottom;
        scrollToBottom();
        return () => {
            if (store.log_box_ref === logContainerRef) store.log_box_ref = null;
            if (store.log_box_scroll_to_bottom === scrollToBottom) store.log_box_scroll_to_bottom = null;
        };
    }, [virtualizer]);

    useLayoutEffect(() => {
        visibleMessageRef.current = virtualizer.getVirtualItemForOffset(logContainerRef.current.scrollTop + 0.5)?.key;
    });

    return (
        <div id="log_container" className={styles.container} ref={logContainerRef}
            style={{ fontSize: `${currentMessageLogUiScaling.data / 100}rem` }}>
            {messages.length === 0 ? (
                <div className={styles.empty_state} role="status">
                    <strong>{t("main_page.live_weave.empty_title")}</strong>
                    <span>{t("main_page.live_weave.empty_detail")}</span>
                </div>
            ) : (
                <div className={styles.virtual_list} style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => (
                        <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
                            className={styles.virtual_row}
                            style={{ transform: `translateY(${row.start}px)`, paddingBottom: row.index === messages.length - 1 ? 0 : "1.35rem" }}>
                            <MessageContainer {...messages[row.index]} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
