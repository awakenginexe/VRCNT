export const isCheckboxInputDisabled = ({ is_available = true, variable }) => (
    !is_available || variable?.state === "pending"
);
