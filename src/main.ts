import fs from "fs";
import dns from "dns";
import url from "url";
import http from "http";
import https from "https";
import Path from "path";
import mime from "./mime.js";
import worker from "worker_threads";
import { Server, Socket } from "socket.io";

function getFilePath(pathname: string): string | null {
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

	switch (method) {
		case "GET":
		case "HEAD":
			break;
		case "OPTIONS":
			res.writeHead(200, "", {
				"Allow": "GET, HEAD, OPTIONS"
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
	} else {
		res.writeHead(404, "", { "Content-Type": "text/plain" });
		res.end("404 Not Found", "utf-8");
	}
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
	if (path == null || !path.startsWith("/mortes/"))
		socket.end("Forbidden", "utf-8");
}

function errorCB(err: Error) {
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
			console.log("HTTP server started on " + (typeof address === "string" ? address : address.address + ":" + address.port))
		});
		return server;
	} else {
		const server = http.createServer({
			maxHeaderSize: 8192
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

const io = new Server(httpServer, {
	path: "/mortes/",
	cors: {
		origin: ["http://localhost:8000", "https://whitespider.gq", "https://whitespider.dev"],
		maxAge: 7200,
		methods: ["GET", "HEAD", "POST"]
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
	socket.on("request_new_session", (opt) => {
		let { width, height, touch, tor } = opt;

		if (typeof width !== "number" || typeof height !== "number" || typeof touch !== "boolean" || typeof tor !== "boolean") {
			socket.disconnect(true);
			return;
		}

		const landscape = width > height;
		width = Math.max(Math.min(width, landscape ? 1280 : 720), 300);
		height = Math.max(Math.min(height, landscape ? 720 : 1280), 300);

		const dataDir = "./local/data-" + Date.now();
		const thread = new worker.Worker(url.fileURLToPath(import.meta.resolve("./worker.js")), {
			name: "Handler",
			workerData: {
				dataDir: dataDir,
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

		socket.onAny((...args) => {
			thread.postMessage(args);
		});
		thread.on("message", (args) => {
			socket.emit.apply(socket, args);
		});

		socket.on("disconnect", () => {
			socket.removeAllListeners();
			thread.removeAllListeners();
			socket.disconnect(true);
			thread.terminate().then(() => {
				fs.rmSync(dataDir, { force: true, recursive: true });
			});
		});
	});
});
