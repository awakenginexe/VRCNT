import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const [root, portText] = process.argv.slice(2);
if (!root || !portText) throw new Error("Usage: node TestServer.mjs ROOT PORT");
const resolvedRoot = path.resolve(root);

http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
    const filePath = path.resolve(resolvedRoot, name);
    if (path.dirname(filePath) !== resolvedRoot || !fs.existsSync(filePath)) {
        response.writeHead(404).end();
        return;
    }
    const size = fs.statSync(filePath).size;
    const match = /^bytes=(\d+)-$/.exec(request.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
        response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
    }
    const headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": size - start,
    };
    if (match) headers["Content-Range"] = `bytes ${start}-${size - 1}/${size}`;
    response.writeHead(match ? 206 : 200, headers);
    fs.createReadStream(filePath, { start }).pipe(response);
}).listen(Number(portText), "127.0.0.1", () => {
    process.stdout.write("ready\n");
});
