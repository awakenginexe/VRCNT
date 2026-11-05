export const authenticatedWebsocketUrl = (host, port, token) => {
    const authority = host.includes(":") ? `[${host}]` : host;
    return `ws://${authority}:${port}/?token=${encodeURIComponent(token)}`;
};
