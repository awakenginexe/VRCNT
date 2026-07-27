export const calculateResourceMenuPosition = (
    anchorRect,
    menuSize,
    viewport,
    gap = 8
) => {
    const left = Math.max(
        gap,
        Math.min(anchorRect.left, viewport.width - menuSize.width - gap)
    );
    const below = anchorRect.bottom + gap;
    const top = below + menuSize.height <= viewport.height - gap
        ? below
        : Math.max(gap, anchorRect.top - menuSize.height - gap);
    return { left, top };
};
