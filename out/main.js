import fs from "fs";
import dns from "dns";
import url from "url";
import http from "http";
import https from "https";
import Path from "path";
import worker from "worker_threads";
import { Server } from "socket.io";
import { AsyncLock } from "./AsyncLock.js";
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
    switch (method) {
        case "GET":
        case "HEAD":
            break;
        case "OPTIONS":
            if (!headers.origin) {
                res.writeHead(200, "", {
                    "Allow": "GET, HEAD, OPTIONS"
                });
                res.end();
                return;
            }
            res.writeHead(200, "", {
                "Allow": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "7200"
            });
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
    res.writeHead(301, "", {
        "Content-Type": "text/plain",
        "Location": "https://whitespider.dev/"
    });
    res.end("301 Moved Permanently", "utf-8");
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
    if (path == null || !path.startsWith("/untrihexium_v2/"))
        socket.end("Forbidden", "utf-8");
}
function errorCB(err) {
    console.error(err);
}
////////////////////////////////////////////////////////////
// INIT
////////////////////////////////////////////////////////////
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["1.1.1.1", "1.0.0.1"]);
dns.promises.setDefaultResultOrder("ipv4first");
dns.promises.setServers(["1.1.1.1", "1.0.0.1"]);
fs.mkdirSync("./local/chrome", { mode: 0o700, recursive: true });
fs.mkdirSync("./local/data", { mode: 0o700, recursive: true });
for (const file of fs.readdirSync("./local/", { encoding: "utf-8" })) {
    // delete temporary files from previous sessions
    if (file.startsWith("data-"))
        fs.rmSync("./local/" + file, { force: true, recursive: true });
}
//////////////////////////////////////////////////
// GPU Worker
//////////////////////////////////////////////////
const gpuLock = new AsyncLock();
//////////////////////////////////////////////////
// HTTP Server
//////////////////////////////////////////////////
const httpServer = (() => {
    const key = Path.resolve("./local/key.txt");
    const cert = Path.resolve("./local/cert.txt");
    if (fs.existsSync(key) && fs.existsSync(cert)) {
        const server = https.createServer({
            key: fs.readFileSync(key, "utf-8"),
            cert: fs.readFileSync(cert, "utf-8"),
            maxHeaderSize: 8192,
            requestTimeout: 15000
        }, void 0);
        server.listen(443, "0.0.0.0", 255, () => {
            const address = server.address() || "unknown address";
            console.log("HTTP server started on " + (typeof address === "string" ? address : address.address + ":" + address.port));
        });
        return server;
    }
    else {
        const server = http.createServer({
            maxHeaderSize: 8192,
            requestTimeout: 15000
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
//////////////////////////////////////////////////
// socket.io
//////////////////////////////////////////////////
const io = new Server(httpServer, {
    path: "/unbioctium/",
    cors: {
        origin: true,
        maxAge: 7200,
        methods: ["GET", "HEAD"],
        credentials: false,
        allowedHeaders: [],
        exposedHeaders: []
    },
    pingTimeout: 10000,
    pingInterval: 15000,
    connectTimeout: 20000,
    upgradeTimeout: 5000,
    httpCompression: true,
    perMessageDeflate: true,
    maxHttpBufferSize: 10000000,
    destroyUpgrade: true,
    destroyUpgradeTimeout: 1000,
    cleanupEmptyChildNamespaces: true
});
io.on("connection", (socket) => {
    let endSession;
    socket.on("end_session", () => {
        if (endSession != null)
            endSession();
    });
    socket.on("disconnect", () => {
        socket.removeAllListeners();
        socket.disconnect(true);
        if (endSession != null)
            endSession();
    });
    socket.on("ns", (options) => {
        if (endSession != null || typeof options !== "object") {
            socket.disconnect(true);
            return;
        }
        let { width, height, touch } = options;
        if (typeof width !== "number" || typeof height !== "number" || typeof touch !== "boolean") {
            socket.disconnect(true);
            return;
        }
        const landscape = width > height;
        const dataDir = "./local/data-" + Date.now();
        width = Math.max(Math.min(width, landscape ? 1280 : 720), 300);
        height = Math.max(Math.min(height, landscape ? 720 : 1280), 300);
        const thread = new worker.Worker(url.fileURLToPath(import.meta.resolve("./worker.unbl.js")), {
            name: "Handler",
            stdin: false,
            stdout: false,
            stderr: false,
            workerData: {
                touch: touch,
                width: width,
                height: height,
                dataDir: dataDir,
                landscape: landscape
            },
            resourceLimits: {
                maxOldGenerationSizeMb: 256,
                maxYoungGenerationSizeMb: 32,
                codeRangeSizeMb: 64,
                stackSizeMb: 8
            }
        });
        const handler = (...args) => thread.postMessage(args);
        socket.onAny(handler);
        thread.on("message", (args) => socket.emit(...args));
        thread.on("error", (err) => {
            console.error("Worker Error: ", err);
            socket.offAny(handler);
            thread.removeAllListeners();
            try {
                fs.rmSync(dataDir, { force: true, recursive: true });
            }
            catch (err) { }
            endSession = void 0;
        });
        endSession = () => {
            socket.offAny(handler);
            thread.removeAllListeners();
            thread.postMessage(["stop"]);
            thread.once("exit", () => {
                try {
                    fs.rmSync(dataDir, { force: true, recursive: true });
                }
                catch (err) { }
                endSession = void 0;
            });
        };
    });
    socket.on("gptreq", async (messages) => {
        if (endSession != null || !Array.isArray(messages)) {
            socket.disconnect(true);
            return;
        }
        await gpuLock;
        gpuLock.lock();
        const thread = new worker.Worker(url.fileURLToPath(import.meta.resolve("./worker.gpu.js")), {
            name: "GPU_Worker",
            stdin: false,
            stdout: false,
            stderr: false,
            workerData: messages,
            resourceLimits: {
                maxOldGenerationSizeMb: 256,
                maxYoungGenerationSizeMb: 32,
                codeRangeSizeMb: 64,
                stackSizeMb: 8
            }
        });
        endSession = () => thread.terminate();
        thread.on("message", (data) => {
            socket.emit("gptres", data);
        });
        try {
            await new Promise((resolve, reject) => {
                thread.once("exit", (code) => code === 0 ? resolve() : reject("Process exited with error code: " + code));
                thread.once("error", (err) => reject(err));
            });
            socket.emit("gptend");
        }
        catch (err) {
            console.error("GPU worker error: ", err);
            socket.emit("gpterr");
        }
        thread.removeAllListeners();
        gpuLock.unlock();
        endSession = void 0;
    });
});
