import fs from "fs";
import dns from "dns";
import url from "url";
import http from "http";
import https from "https";
import Path from "path";
import mime from "./mime.js";
import stream from "stream";
import worker from "worker_threads";
import { Server } from "socket.io";
function randA(seed) { if ("number" != typeof seed || !Number.isSafeInteger(seed))
    throw new Error("Seed must be a safe integer."); return seed = (1664525 * seed + 1013904223) % Math.pow(2, 32); }
function randB(seed) { if ("number" != typeof seed || !Number.isSafeInteger(seed))
    throw new Error("Seed must be a safe integer."); let r = seed; return r ^= r << 13, r ^= r >> 17, r ^= r << 5, r >>> 0; }
function validateKey(headers) {
    const seed = Math.floor(Date.now() / 3600000);
    const sig0 = headers["x-m2918"];
    const sig1 = headers["x-m1294"];
    const sig2 = headers["x-t" + seed.toString(30)];
    if (typeof sig0 !== "string" || typeof sig1 !== "string" || typeof sig2 !== "string")
        return false;
    const key = Buffer.from(sig0 + sig1 + sig2, "base64");
    if (key.byteLength !== 16)
        return false;
    const int0 = key.readUint32LE(0);
    const int1 = key.readUint32LE(4);
    const int2 = key.readUint32LE(8);
    const int3 = key.readUint32LE(12);
    return randB(seed) === int0 &&
        randB(int0) === int1 &&
        randA(seed) === int2 &&
        randA(int2) === int3;
}
function getFilePath(pathname) {
    const path = Path.resolve("./static/" + pathname);
    if (fs.existsSync(path)) {
        if (fs.lstatSync(path, { bigint: true, throwIfNoEntry: true }).isDirectory()) {
            for (const f of ["index.html", "index.xht", "index.htm", "index.xhtml", "index.xml", "index.svg"]) {
                const p = Path.join(path, f);
                if (fs.existsSync(p))
                    return p;
            }
            return null;
        }
        return path;
    }
    return null;
}
function getStreamBody(str) {
    return new Promise((resolve, reject) => {
        const out = new stream.PassThrough();
        const chunks = [];
        out.once("error", (err) => reject(err));
        out.once("end", () => resolve(Buffer.concat(chunks)));
        out.on("data", (buf) => chunks.push(buf));
        str.pipe(out, { end: true });
    });
}
function parseRequestData(buf) {
    let json;
    try {
        json = JSON.parse(buf.toString("utf-8"));
    }
    catch (err) {
        return null;
    }
    if (!Array.isArray(json))
        return null;
    for (const arg of json) {
        if (typeof arg !== "object" || typeof arg.content !== "string")
            return null;
    }
    return json;
}
async function handleGPTRequest(req, res) {
    const msg = parseRequestData(await getStreamBody(req));
    if (msg == null) {
        res.writeHead(400, "", { "Content-Type": "text/plain" });
        res.end("400 Bad Request", "utf-8");
        return;
    }
    await lock;
    lock = new Promise((r) => void (resolve = r));
    response = res;
    gpuWorker.postMessage(msg);
}
function handleRequest(req, res) {
    const method = req.method;
    const headers = req.headers;
    const rawPath = req.url;
    const host = headers.host;
    if (method == null || rawPath == null || host == null) {
        res.writeHead(400, "", { "Content-Type": "text/plain" });
        res.end("400 Bad Request", "utf-8");
        return;
    }
    if (method === "POST" && rawPath === "/" && validateKey(headers)) {
        handleGPTRequest(req, res);
        return;
    }
    switch (method) {
        case "GET":
        case "HEAD":
            break;
        case "OPTIONS":
            switch (headers.origin) {
                case "http://localhost:8000":
                case "https://whitespider.gq":
                case "https://whitespider.dev":
                case "https://whitespider.eu.org":
                    res.writeHead(200, "", {
                        "Allow": "GET, HEAD, OPTIONS",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "*",
                        "Access-Control-Allow-Headers": "*",
                        "Access-Control-Max-Age": "7200"
                    });
                    break;
                default:
                    res.writeHead(200, "", {
                        "Allow": "GET, HEAD, OPTIONS"
                    });
                    break;
            }
            res.end();
            return;
        default:
            res.writeHead(405, "", {
                "Allow": "GET, HEAD, OPTIONS",
                "Content-Type": "text/plain"
            });
            res.end("405 Method Not Allowed", "utf-8");
            return;
    }
    const url = new URL(rawPath, "https://" + host);
    const path = getFilePath(url.pathname);
    if (path != null) {
        res.writeHead(200, "", {
            "Content-Type": mime[Path.extname(path)] || "application/octet-stream",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff"
        });
        if (method === "HEAD")
            res.end();
        else
            res.end(fs.readFileSync(path), "utf-8");
    }
    else {
        res.writeHead(404, "", { "Content-Type": "text/plain" });
        res.end("404 Not Found", "utf-8");
    }
}
function requestCB(req, res) {
    try {
        handleRequest(req, res);
    }
    catch (err) {
        console.error(err);
        res.writeHead(500, "", { "Content-Type": "text/plain" });
        res.end("500 Internal Server Error", "utf-8");
    }
}
function upgradeCB(req, socket, head) {
    const path = req.url;
    if (path == null || !path.startsWith("/untrihexium/"))
        socket.end("Forbidden", "utf-8");
}
function errorCB(err) {
    console.error(err);
}
//////////////////////////////////////////////////////////
// INIT
//////////////////////////////////////////////////////////
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["1.1.1.1", "1.0.0.1"]);
dns.promises.setDefaultResultOrder("ipv4first");
dns.promises.setServers(["1.1.1.1", "1.0.0.1"]);
fs.mkdirSync("./local/chrome", { mode: 0o700, recursive: true });
fs.mkdirSync("./local/data", { mode: 0o700, recursive: true });
let lock = null;
let resolve = null;
let response = null;
const gpuWorker = new worker.Worker(url.fileURLToPath(import.meta.resolve("./worker.gpu.js")), {
    name: "GPU_Worker",
    workerData: {},
    resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        codeRangeSizeMb: 64,
        stackSizeMb: 8
    }
});
await new Promise((resolve, reject) => {
    gpuWorker.once("message", (msg) => {
        if (msg === "worker_ready")
            resolve();
        else
            reject("Unexpected message received: " + msg);
    });
    gpuWorker.once("error", (err) => reject(err));
    gpuWorker.once("exit", () => reject("GPU worker exited"));
});
gpuWorker.on("error", () => {
    if (response != null) {
        response.writeHead(500, "", { "Content-Type": "text/plain" });
        response.end("500 Internal Server Error", "utf-8");
    }
    resolve?.apply(void 0, []);
    resolve = lock = response = null;
});
gpuWorker.on("message", (msg) => {
    if (resolve == null || response == null || typeof msg !== "string")
        throw new Error("Internal logic error");
    response.writeHead(200, "", {
        "Content-Type": "application/octet-stream",
        "Access-Control-Allow-Origin": "*"
    });
    response.end(Buffer.from(msg, "utf-8"), "utf-8");
    resolve();
    resolve = lock = response = null;
});
const httpServer = (() => {
    const key = Path.resolve("./local/key.txt");
    const cert = Path.resolve("./local/cert.txt");
    if (fs.existsSync(key) && fs.existsSync(cert)) {
        const server = https.createServer({
            key: fs.readFileSync(key, "utf-8"),
            cert: fs.readFileSync(cert, "utf-8"),
            maxHeaderSize: 8192
        }, void 0);
        server.listen(443, "0.0.0.0", 255, () => {
            const address = server.address() || "unknown address";
            console.log("HTTP server started on " + (typeof address === "string" ? address : address.address + ":" + address.port));
        });
        return server;
    }
    else {
        const server = http.createServer({
            maxHeaderSize: 8192
        }, void 0);
        server.listen(80, "0.0.0.0", 255, () => {
            const address = server.address() || "unknown address";
            console.log("HTTP server started on " + (typeof address === "string" ? address : address.address + ":" + address.port));
        });
        return server;
    }
})();
httpServer.on("request", requestCB);
httpServer.on("upgrade", upgradeCB);
httpServer.on("error", errorCB);
const io = new Server(httpServer, {
    path: "/untrihexium/",
    cors: {
        origin: [
            "http://localhost:8000",
            "https://whitespider.gq",
            "https://whitespider.dev",
            "https://whitespider.eu.org"
        ],
        maxAge: 7200,
        methods: ["GET", "HEAD", "POST"],
        credentials: false,
        allowedHeaders: [],
        exposedHeaders: []
    },
    pingTimeout: 10000,
    pingInterval: 15000,
    connectTimeout: 20000,
    upgradeTimeout: 5000,
    destroyUpgrade: true,
    destroyUpgradeTimeout: 1000,
    maxHttpBufferSize: 1024,
    httpCompression: true,
    perMessageDeflate: true
});
io.on("connection", (socket) => {
    let thread = null;
    let dataDir = null;
    const endSession = () => {
        if (thread != null) {
            thread.removeAllListeners();
            thread.terminate().then(() => {
                try {
                    fs.rmSync(dataDir, { force: true, recursive: true });
                }
                catch (err) {
                }
                thread = null;
                dataDir = null;
            });
        }
    };
    socket.onAny((...args) => {
        thread?.postMessage(args);
    });
    socket.on("end_session", endSession);
    socket.on("disconnect", () => {
        socket.removeAllListeners();
        socket.disconnect(true);
        endSession();
    });
    socket.on("request_new_session", async (options) => {
        let { width, height, touch } = options;
        if (thread != null || typeof width !== "number" || typeof height !== "number" || typeof touch !== "boolean") {
            socket.disconnect(true);
            return;
        }
        const landscape = width > height;
        width = Math.max(Math.min(width, landscape ? 1280 : 720), 300);
        height = Math.max(Math.min(height, landscape ? 720 : 1280), 300);
        thread = new worker.Worker(url.fileURLToPath(import.meta.resolve("./worker.unbl.js")), {
            name: "Handler",
            workerData: {
                dataDir: dataDir = "./local/data-" + Date.now(),
                width: width,
                height: height,
                touch: touch,
                landscape: landscape
            },
            resourceLimits: {
                maxOldGenerationSizeMb: 256,
                maxYoungGenerationSizeMb: 32,
                codeRangeSizeMb: 64,
                stackSizeMb: 8
            }
        });
        thread.on("message", (args) => {
            socket.emit.apply(socket, args);
        });
    });
});
