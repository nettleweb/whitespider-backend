import fs from "fs";
import dns from "dns";
import url from "url";
import http from "http";
import https from "https";
import Path from "path";
import stream from "stream";
import worker from "worker_threads";
import { Server } from "socket.io";
import { AsyncLock } from "./AsyncLock.js";

function randA(seed: number) { if ("number" != typeof seed || !Number.isSafeInteger(seed)) throw new Error("Seed must be a safe integer."); return seed = (1664525 * seed + 1013904223) % Math.pow(2, 32) }
function randB(seed: number) { if ("number" != typeof seed || !Number.isSafeInteger(seed)) throw new Error("Seed must be a safe integer."); let r = seed; return r ^= r << 13, r ^= r >> 17, r ^= r << 5, r >>> 0 }

function validateKey(headers: Record<string, any>) {
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

function getStreamBody(str: stream.Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const out = new stream.PassThrough();
		const chunks: Buffer[] = [];

		out.once("error", (err) => reject(err));
		out.once("end", () => resolve(Buffer.concat(chunks)));
		out.on("data", (buf) => chunks.push(buf));

		str.pipe(out, { end: true });
	});
}

function parseRequestData(buf: Buffer): import("gpt4all").PromptMessage[] | null {
	let json;

	try {
		json = JSON.parse(buf.toString("utf-8"));
	} catch (err) {
		return null
	}

	if (!Array.isArray(json))
		return null;

	for (const arg of json) {
		if (typeof arg !== "object" || typeof arg.content !== "string")
			return null;
	}

	return json;
}

async function handleGPTRequest(req: http.IncomingMessage, res: http.ServerResponse) {
	const msg = parseRequestData(await getStreamBody(req));
	if (msg == null) {
		res.writeHead(400, "", { "Content-Type": "text/plain" });
		res.end("400 Bad Request", "utf-8");
		return;
	}

	await gpuLock; gpuLock.lock();
	res.writeHead(200, "", {
		"Content-Type": "application/octet-stream",
		"Access-Control-Allow-Origin": "*"
	});

	const thread = new worker.Worker(url.fileURLToPath(import.meta.resolve("./worker.gpu.js")), {
		name: "GPU_Worker",
		stdin: false,
		stdout: false,
		stderr: false,
		workerData: msg,
		resourceLimits: {
			maxOldGenerationSizeMb: 256,
			maxYoungGenerationSizeMb: 32,
			codeRangeSizeMb: 64,
			stackSizeMb: 8
		}
	});

	thread.on("message", (data) => {
		res.write(data, "utf-8");
	});

	try {
		await new Promise<void>((resolve, reject) => {
			thread.once("exit", (code) => {
				if (code === 0)
					resolve();
				else
					reject("Process exited with non-zero code.");
			});
			thread.once("error", (err) => reject(err));
		});
		res.end();
	} catch (err) {
		console.error(err);
		res.end("\n\nError: Generation aborted due to error on server side.\n", "utf-8");
	}

	await thread.terminate(); // ensure worker is dead
	thread.removeAllListeners();
	gpuLock.unlock();
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
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

function requestCB(req: http.IncomingMessage, res: http.ServerResponse) {
	try {
		handleRequest(req, res);
	} catch (err) {
		console.error(err);
		res.writeHead(500, "", { "Content-Type": "text/plain" });
		res.end("500 Internal Server Error", "utf-8");
	}
}

function upgradeCB(req: http.IncomingMessage, socket: import("stream").Duplex, head: Buffer) {
	const path = req.url;
	if (path == null || !path.startsWith("/untrihexium_v2/"))
		socket.end("Forbidden", "utf-8");
}

function errorCB(err: Error) {
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

const gpuLock: AsyncLock = new AsyncLock();

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
			console.log("HTTP server started on " + (typeof address === "string" ? address : address.address + ":" + address.port))
		});
		return server;
	} else {
		const server = http.createServer({
			maxHeaderSize: 8192,
			requestTimeout: 15000
		}, void 0);
		server.listen(80, "0.0.0.0", 255, () => {
			const address = server.address() || "unknown address";
			console.log("HTTP server started on " + (typeof address === "string" ? address : address.address + ":" + address.port))
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
	path: "/untrihexium_v2/",
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
	maxHttpBufferSize: 1024,
	destroyUpgrade: true,
	destroyUpgradeTimeout: 1000,
	cleanupEmptyChildNamespaces: true
});
io.on("connection", (socket) => {
	let endSession: (() => void) | undefined;

	socket.on("end_session", () => {
		endSession?.apply(void 0, []);
	});
	socket.on("disconnect", () => {
		socket.removeAllListeners();
		socket.disconnect(true);
		endSession?.apply(void 0, []);
	});
	socket.on("request_new_session", (options) => {
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

		socket.onAny((...args) => thread.postMessage(args));
		thread.on("message", (args) => socket.emit.apply(socket, args));
		thread.on("error", (err) => {
			console.error("Worker Error: ", err);
			thread.removeAllListeners();
			try {
				fs.rmSync(dataDir, { force: true, recursive: true });
			} catch (err) { }
			endSession = void 0;
		});

		endSession = () => {
			thread.removeAllListeners();
			thread.postMessage(["stop"]);
			thread.once("exit", () => {
				try {
					fs.rmSync(dataDir, { force: true, recursive: true });
				} catch (err) { }
				endSession = void 0;
			});
		};
	});
});
