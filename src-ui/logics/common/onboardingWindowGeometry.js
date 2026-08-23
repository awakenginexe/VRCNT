const isInteger = (value) => Number.isInteger(value);
const WINDOW_STATE_SETTLE_ATTEMPTS = 12;

const waitForWindowEventLoop = () => new Promise((resolve) => {
    setTimeout(resolve, 16);
});

const isValidOnboardingWindowGeometry = (geometry) => (
    geometry
    && isInteger(geometry.x_pos)
    && isInteger(geometry.y_pos)
    && isInteger(geometry.width)
    && isInteger(geometry.height)
    && geometry.width > 0
    && geometry.height > 0
    && typeof geometry.maximized === "boolean"
);

export const captureOnboardingWindowGeometry = async (appWindow) => {
    if (!appWindow) return null;

    const [position, size, maximized] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        appWindow.isMaximized(),
    ]);
    const geometry = {
        x_pos: position.x,
        y_pos: position.y,
        width: size.width,
        height: size.height,
        maximized,
    };

    return isValidOnboardingWindowGeometry(geometry) ? geometry : null;
};

const waitForNormalWindowState = async (appWindow) => {
    for (let attempt = 0; attempt < WINDOW_STATE_SETTLE_ATTEMPTS; attempt += 1) {
        if (await appWindow.isMaximized() === false) return true;
        await waitForWindowEventLoop();
    }

    return false;
};

export const restoreOnboardingWindowGeometry = async ({
    appWindow,
    geometry,
    createPhysicalPosition,
    createPhysicalSize,
}) => {
    if (
        !appWindow
        || !isValidOnboardingWindowGeometry(geometry)
        || typeof createPhysicalPosition !== "function"
        || typeof createPhysicalSize !== "function"
    ) return false;

    if (geometry.maximized) {
        await appWindow.maximize();
        return true;
    }

    if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
        if (!await waitForNormalWindowState(appWindow)) return false;
    }

    await appWindow.setSize(createPhysicalSize(geometry.width, geometry.height));
    await appWindow.setPosition(createPhysicalPosition(geometry.x_pos, geometry.y_pos));
    return true;
};
