const getBounds = (rect) => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
});

const getViewportBounds = (viewport) => {
    const left = viewport?.left ?? 0;
    const top = viewport?.top ?? 0;
    const right = viewport?.right ?? left + (viewport?.width ?? 0);
    const bottom = viewport?.bottom ?? top + (viewport?.height ?? 0);

    return { left, top, right, bottom };
};

const isEmpty = (bounds) => (
    bounds.right <= bounds.left || bounds.bottom <= bounds.top
);

const clipToBounds = (bounds, clipBounds, clipX, clipY) => ({
    left: clipX ? Math.max(bounds.left, clipBounds.left) : bounds.left,
    top: clipY ? Math.max(bounds.top, clipBounds.top) : bounds.top,
    right: clipX ? Math.min(bounds.right, clipBounds.right) : bounds.right,
    bottom: clipY ? Math.min(bounds.bottom, clipBounds.bottom) : bounds.bottom,
});

const isClipping = (overflow) => overflow !== "visible";

const isScrollableOverflow = (overflow) => (
    overflow === "auto" || overflow === "scroll" || overflow === "overlay"
);

const getOnboardingScrollOwner = ({ target, documentRef, getComputedStyle }) => {
    let ancestor = target?.parentElement;

    while (ancestor && ancestor !== documentRef?.body && ancestor !== documentRef?.documentElement) {
        const computedStyle = getComputedStyle?.(ancestor);
        const canScrollVertically = isScrollableOverflow(computedStyle?.overflowY)
            && ancestor.scrollHeight > ancestor.clientHeight;

        if (canScrollVertically) return ancestor;

        ancestor = ancestor.parentElement;
    }

    return null;
};

export const getOnboardingTourPortalRoot = (documentRef) => documentRef?.body ?? null;

export const scrollOnboardingTargetIntoView = ({ target, documentRef, getComputedStyle }) => {
    if (!target || typeof target.getBoundingClientRect !== "function") return false;

    const scrollOwner = getOnboardingScrollOwner({ target, documentRef, getComputedStyle });
    if (!scrollOwner) return false;

    const targetBounds = getBounds(target.getBoundingClientRect());
    const scrollOwnerBounds = getBounds(scrollOwner.getBoundingClientRect());
    const targetHeight = targetBounds.bottom - targetBounds.top;
    const maxScrollTop = Math.max(0, scrollOwner.scrollHeight - scrollOwner.clientHeight);
    const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(
            0,
            scrollOwner.scrollTop
                + targetBounds.top
                - scrollOwnerBounds.top
                - ((scrollOwner.clientHeight - targetHeight) / 2),
        ),
    );

    if (scrollOwner.scrollTop === nextScrollTop) return false;

    scrollOwner.scrollTop = nextScrollTop;
    return true;
};

export const resetOnboardingRootScroll = ({ documentRef, windowRef }) => {
    const scrollRoots = new Set([
        documentRef?.scrollingElement,
        documentRef?.documentElement,
        documentRef?.body,
    ]);

    for (const scrollRoot of scrollRoots) {
        if (!scrollRoot) continue;
        scrollRoot.scrollTop = 0;
        scrollRoot.scrollLeft = 0;
    }

    windowRef?.scrollTo?.(0, 0);
};

export const getOnboardingTourContentViewport = ({ viewport, titleBarBounds }) => {
    const viewportBounds = getViewportBounds(viewport);
    const titleBarBottom = titleBarBounds?.bottom ?? viewportBounds.top;
    const top = Math.min(
        viewportBounds.bottom,
        Math.max(viewportBounds.top, titleBarBottom),
    );

    return {
        left: viewportBounds.left,
        top,
        right: viewportBounds.right,
        bottom: viewportBounds.bottom,
        width: viewportBounds.right - viewportBounds.left,
        height: viewportBounds.bottom - top,
    };
};

export const toOnboardingTourContentCoordinates = ({ bounds, contentViewport }) => ({
    left: bounds.left - contentViewport.left,
    top: bounds.top - contentViewport.top,
    right: bounds.right - contentViewport.left,
    bottom: bounds.bottom - contentViewport.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
});

export const getVisibleSpotlightRect = ({
    target,
    viewport,
    getComputedStyle,
    padding = 0,
}) => {
    if (!target || !viewport || typeof target.getBoundingClientRect !== "function") return null;

    let visibleBounds = getViewportBounds(viewport);
    let ancestor = target.parentElement;

    while (ancestor) {
        const computedStyle = getComputedStyle?.(ancestor);
        const clipX = isClipping(computedStyle?.overflowX ?? "visible");
        const clipY = isClipping(computedStyle?.overflowY ?? "visible");

        if (clipX || clipY) {
            visibleBounds = clipToBounds(
                visibleBounds,
                getBounds(ancestor.getBoundingClientRect()),
                clipX,
                clipY,
            );
            if (isEmpty(visibleBounds)) return null;
        }

        ancestor = ancestor.parentElement;
    }

    const visibleTargetBounds = clipToBounds(
        getBounds(target.getBoundingClientRect()),
        visibleBounds,
        true,
        true,
    );
    if (isEmpty(visibleTargetBounds)) return null;

    const spotlightBounds = {
        left: Math.max(visibleBounds.left, visibleTargetBounds.left - padding),
        top: Math.max(visibleBounds.top, visibleTargetBounds.top - padding),
        right: Math.min(visibleBounds.right, visibleTargetBounds.right + padding),
        bottom: Math.min(visibleBounds.bottom, visibleTargetBounds.bottom + padding),
    };

    return {
        ...spotlightBounds,
        width: spotlightBounds.right - spotlightBounds.left,
        height: spotlightBounds.bottom - spotlightBounds.top,
    };
};
