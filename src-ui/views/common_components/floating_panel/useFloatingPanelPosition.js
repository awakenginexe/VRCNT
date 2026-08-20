import { useLayoutEffect, useState } from "react";

const DEFAULT_GAP = 8;
const DEFAULT_PADDING = 12;
const DEFAULT_PANEL_HEIGHT = 360;

const toFiniteNumber = (value, fallback) => (
    Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export const calculateFloatingPanelPosition = ({
    anchorRect,
    panelSize = {},
    viewport,
    gap = DEFAULT_GAP,
    padding = DEFAULT_PADDING,
    verticalAlignment = "auto",
}) => {
    const anchorLeft = toFiniteNumber(anchorRect?.left, 0);
    const anchorTop = toFiniteNumber(anchorRect?.top, 0);
    const anchorBottom = toFiniteNumber(anchorRect?.bottom, anchorTop);
    const anchorWidth = Math.max(
        1,
        toFiniteNumber(panelSize.width, toFiniteNumber(anchorRect?.width, anchorRect?.right - anchorLeft)),
    );
    const viewportWidth = Math.max(1, toFiniteNumber(viewport?.width, 1));
    const viewportHeight = Math.max(1, toFiniteNumber(viewport?.height, 1));
    const safeGap = Math.max(0, toFiniteNumber(gap, DEFAULT_GAP));
    const safePadding = Math.max(0, toFiniteNumber(padding, DEFAULT_PADDING));
    const width = Math.min(anchorWidth, Math.max(1, viewportWidth - safePadding * 2));
    const maxLeft = Math.max(safePadding, viewportWidth - width - safePadding);
    const left = clamp(anchorLeft, safePadding, maxLeft);

    if (verticalAlignment === "anchor-start") {
        const maxTop = Math.max(safePadding, viewportHeight - safePadding - 1);
        const top = clamp(anchorTop, safePadding, maxTop);

        return {
            top,
            left,
            width,
            maxHeight: Math.max(1, viewportHeight - top - safePadding),
            placement: "anchor-start",
        };
    }

    const desiredHeight = Math.max(
        1,
        toFiniteNumber(panelSize.height, DEFAULT_PANEL_HEIGHT),
    );
    const spaceBelow = Math.max(1, viewportHeight - anchorBottom - safeGap - safePadding);
    const spaceAbove = Math.max(1, anchorTop - safeGap - safePadding);
    const fitsBelow = spaceBelow >= desiredHeight;
    const fitsAbove = spaceAbove >= desiredHeight;
    const placement = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow) ? "above" : "below";
    const maxHeight = placement === "above" ? spaceAbove : spaceBelow;
    const top = placement === "above"
        ? anchorTop - safeGap - Math.min(desiredHeight, maxHeight)
        : anchorBottom + safeGap;

    return { top, left, width, maxHeight, placement };
};

const resolvePanelWidth = (width, anchorRect) => {
    if (width === undefined || width === null || width === "anchor") {
        return anchorRect.width;
    }

    return toFiniteNumber(width, anchorRect.width);
};

export const useFloatingPanelPosition = (
    anchorRef,
    {
        open = false,
        width = "anchor",
        gap = DEFAULT_GAP,
        padding = DEFAULT_PADDING,
        panelRef,
        verticalAlignment = "auto",
    } = {},
) => {
    const [position, setPosition] = useState(null);
    const [placement, setPlacement] = useState("below");

    useLayoutEffect(() => {
        if (!open) {
            setPosition(null);
            setPlacement("below");
            return undefined;
        }

        if (typeof window === "undefined" || !anchorRef?.current) {
            return undefined;
        }

        const updatePosition = () => {
            const anchorElement = anchorRef.current;
            if (!anchorElement) return;

            const anchorRect = anchorElement.getBoundingClientRect();
            const renderedPanelRect = panelRef?.current?.getBoundingClientRect?.();
            const measuredPanelHeight = toFiniteNumber(renderedPanelRect?.height, 0);
            const nextPosition = calculateFloatingPanelPosition({
                anchorRect,
                panelSize: {
                    width: resolvePanelWidth(width, anchorRect),
                    height: measuredPanelHeight > 0
                        ? measuredPanelHeight
                        : DEFAULT_PANEL_HEIGHT,
                },
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                },
                gap,
                padding,
                verticalAlignment,
            });

            setPosition(nextPosition);
            setPlacement(nextPosition.placement);
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        let resizeObserver;
        if (typeof ResizeObserver === "function" && panelRef?.current) {
            resizeObserver = new ResizeObserver(updatePosition);
            resizeObserver.observe(panelRef.current);
        }

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
            resizeObserver?.disconnect();
        };
    }, [anchorRef, gap, open, padding, panelRef, verticalAlignment, width]);

    const style = position
        ? {
            position: "fixed",
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
        }
        : (() => {
            const anchorRect = anchorRef?.current?.getBoundingClientRect?.();
            const initialWidth = anchorRect
                ? resolvePanelWidth(width, anchorRect)
                : undefined;
            return {
                position: "fixed",
                visibility: "hidden",
                ...(Number.isFinite(Number(initialWidth)) && Number(initialWidth) > 0
                    ? { width: initialWidth }
                    : {}),
            };
        })();

    return { style, placement };
};
