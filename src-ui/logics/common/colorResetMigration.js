export const COLOR_RESET_MIGRATION_KEY = "5_9_0_color_reset";
export const COLOR_RESET_MIGRATION_COMPLETE = 1;

export const isColorResetMigrationComplete = (value) => (
    Number(value) === COLOR_RESET_MIGRATION_COMPLETE
);

export const isColorResetMigrationRequired = ({
    isTauri,
    isBackendReady,
    flagValue,
}) => (
    isTauri === true
    && isBackendReady === true
    && !isColorResetMigrationComplete(flagValue)
);
