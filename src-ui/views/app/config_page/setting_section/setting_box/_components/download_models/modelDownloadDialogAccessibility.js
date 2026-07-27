export const handleModelDownloadDialogKeyDown = (event, {
    activeElement,
    focusableElements,
    onCancel,
}) => {
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
    }
    if (event.key !== "Tab" || focusableElements.length === 0) return;

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    const focusIsContained = focusableElements.includes(activeElement);

    if (event.shiftKey && (activeElement === firstFocusable || !focusIsContained)) {
        event.preventDefault();
        lastFocusable.focus();
        return;
    }
    if (!event.shiftKey && (activeElement === lastFocusable || !focusIsContained)) {
        event.preventDefault();
        firstFocusable.focus();
    }
};

export const setModelDownloadBackgroundInert = (background) => {
    if (!background) return () => {};

    const wasAlreadyInert = background.hasAttribute("inert");
    background.setAttribute("inert", "");

    return () => {
        if (!wasAlreadyInert) background.removeAttribute("inert");
    };
};
