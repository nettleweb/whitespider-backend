import fs from "fs";
import dns from "dns";
import url from "url";
import http from "http";
import Path from "path"
import crypto from "crypto";
import worker from "worker_threads";
import { Server } from "socket.io";
import { Token, getLlama } from "node-llama-cpp";
import { AsyncLock } from "./AsyncLock.js";

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

	if (host.endsWith(".unbioctium.com")) {
		res.writeHead(301, "", {
			"Content-Type": "text/plain",
			"Location": "https://unbioctium.com/"
		});
	} else {
		res.writeHead(301, "", {
			"Content-Type": "text/plain",
			"Location": "https://whitespider.dev/"
		});
	}

	res.end();
}

async function fetchJSON(url: string | URL, signal: AbortSignal): Promise<any> {
	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				"Accept": "application/json"
			},
			signal: signal
		});
		return res.ok ? await res.json() : null;
	} catch (err) {
		console.error(err);
		return null;
	}
}

async function fetchBuffer(url: string | URL): Promise<ArrayBuffer | null> {
	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				"Accept": "application/json"
			}
		});
		return res.ok ? await res.arrayBuffer() : null;
	} catch (err) {
		console.error(err);
		return null;
	}
}

async function handleLogin(token: string, signal: AbortSignal): Promise<string> {
	const user = await fetchJSON("https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=" + encodeURIComponent(token), signal);
	if (user == null)
		throw new Error("Failed to retrieve user data.");

	const email = user.email;
	if (typeof email !== "string")
		throw new Error("Failed to retrieve user email.");
	if (!user.verified_email)
		throw new Error("The account does not have a verified email.");

	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	let id: string | null = null;

	for (const k of Object.keys(list)) {
		if (list[k].email === email) {
			id = k;
			break;
		}
	}

	if (id == null) {
		id = email.slice(0, email.indexOf("@", 5)) || Math.floor(Math.random() * 10000000).toString(8);
		while (list[id] != null)
			id += Math.floor(Math.random() * 36).toString(36);

		// generate account secrets
		let secrets: string = "";
		for (const ch of crypto.getRandomValues(new Uint8Array(new ArrayBuffer(1024), 0, 1024)))
			secrets += ch.toString(16).padStart(2, "0");

		// generate uid
		const uid = Date.now().toString(36);

		list[id] = {
			vip: null,
			uid: uid,
			name: user.name,
			email: email,
			secrets: secrets
		};
		fs.writeFileSync("./local/users.json", JSON.stringify(list, void 0, "\t"), {
			mode: 0o600,
			flush: true,
			encoding: "utf-8"
		});

		let avatar: ArrayBuffer | null = await fetchBuffer(user.picture);
		if (avatar == null)
			avatar = fs.readFileSync("./res/user.png").buffer;

		fs.writeFileSync("./local/avatar/" + uid + ".jpg", Buffer.from(avatar), {
			mode: 0o600,
			flush: true
		});

		return secrets;
	}

	return list[id].secrets;
}

async function handleUserInfo(uid: string, signal: AbortSignal): Promise<any> {
	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	let info = null;

	for (const k of Object.keys(list)) {
		const v = list[k];
		if (v.uid === uid) {
			v.id = k;
			info = v;
			break;
		}
	}

	return Object.freeze(Object.setPrototypeOf({
		id: info.id,
		avatar: await fs.promises.readFile("./local/avatar/" + uid + ".jpg", { signal: signal })
	}, null));
}

async function handleUserData(secrets: string, signal: AbortSignal): Promise<any> {
	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	let info = null;

	for (const k of Object.keys(list)) {
		const v = list[k];
		if (v.secrets === secrets) {
			v.id = k;
			info = v;
			break;
		}
	}

	if (info == null)
		throw new Error("Invalid credentials");

	const uid = info.uid;

	return Object.freeze((Object.setPrototypeOf({
		id: info.id,
		uid: uid,
		vip: info.vip,
		name: info.name,
		email: info.email,
		avatar: (await fs.promises.readFile("./local/avatar/" + uid + ".jpg", { signal: signal })).buffer
	}, null)));
}

async function handleChangeId(secrets: string, newId: string, signal: AbortSignal): Promise<void> {
	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	if ((newId = newId.trim().toLowerCase()) in list)
		throw new Error("User ID already exists: " + newId);

	let info = null;

	for (const k of Object.keys(list)) {
		const v = list[k];
		if (v.secrets === secrets) {
			delete list[k];
			info = v;
			break;
		}
	}

	if (info == null)
		throw new Error("Invalid credentials");

	list[newId] = info;
	fs.writeFileSync("./local/users.json", JSON.stringify(list, void 0, "\t"), {
		mode: 0o600,
		flush: true,
		encoding: "utf-8"
	});
}

async function handleChangeAvatar(secrets: string, img: Buffer, signal: AbortSignal): Promise<void> {
	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	let uid = null;

	for (const k of Object.keys(list)) {
		const v = list[k];
		if (v.secrets === secrets) {
			uid = v.uid;
			break;
		}
	}

	if (uid == null)
		throw new Error("Invalid credentials");

	fs.writeFileSync("./local/avatar/" + uid + ".jpg", img, {
		mode: 0o600,
		flush: true,
		signal: signal
	});
}

async function handleUploadGames(secrets: string, data: any[], signal: AbortSignal): Promise<void> {
	const [name, type, tags, desc, buffer] = data;
	if (typeof name !== "string" || typeof type !== "string" || typeof tags !== "string" || typeof desc !== "string")
		throw new Error("Invalid game data");

	let uid = null;

	{
		const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
			signal: signal,
			encoding: "utf-8"
		}));

		for (const k of Object.keys(list)) {
			const v = list[k];
			if (v.secrets === secrets) {
				uid = v.uid;
				break;
			}
		}

		if (uid == null)
			throw new Error("Invalid credentials");
	}

	const index = JSON.parse(fs.readFileSync("./local/games/index.json", "utf-8"));
	const nameMap: Record<string, string> = {
		"html5": ".zip",
		"flash": ".swf",
		"dos": ".jsdos"
	};

	const extname = nameMap[type];
	if (extname == null)
		throw new Error("Invalid game type");

	const fileName = Path.join("/games/", type, name.toLowerCase().replace(/[^0-9a-z\-]/g, (ch) => {
		switch (ch) {
			case "-":
			case " ":
			case "\t":
			case "\n":
				return "-";
			default:
				return "";
		}
	}) + extname);

	const absFile = Path.join("./local/", fileName);
	if (fs.existsSync(absFile))
		throw new Error("The game already exists.");

	fs.writeFileSync(absFile, buffer, {
		mode: 0o600,
		flush: true,
		encoding: "utf-8"
	});

	index.push({
		name: name,
		type: type,
		tags: tags,
		desc: desc,
		file: fileName,
		date: Date.now(),
		user: uid
	});

	fs.writeFileSync("./local/games/index.json", JSON.stringify(index, void 0, "\t"), {
		mode: 0o600,
		flush: true,
		encoding: "utf-8"
	});
}

async function handleFetch(path: string, data: any, signal: AbortSignal): Promise<any> {
	switch (path) {
		case "login":
			return await handleLogin(data, signal);
		case "userinfo":
			return await handleUserInfo(data, signal);
		case "userdata":
			return await handleUserData(data, signal);
		case "changeid":
			return await handleChangeId(data[0], data[1], signal);
		case "changeavatar":
			return await handleChangeAvatar(data[0], data[1], signal);
		case "uploadgame":
			return await handleUploadGames(data.shift(), data, signal);
		default:
			throw new Error("Invalid path: " + path);
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
	if (path == null || !path.startsWith("/__api_/"))
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

fs.rmSync("./local/sessions", { force: true, recursive: true });
fs.mkdirSync("./local/avatar", { mode: 0o700, recursive: true });
fs.mkdirSync("./local/chrome", { mode: 0o700, recursive: true });
fs.mkdirSync("./local/models", { mode: 0o700, recursive: true });
fs.mkdirSync("./local/sessions", { mode: 0o700, recursive: true });

//////////////////////////////////////////////////
// GPU Worker
//////////////////////////////////////////////////

const gpuLock: AsyncLock = new AsyncLock();

const llama = await getLlama({
	gpu: "cuda",
	build: "auto",
	usePrebuiltBinaries: false,
	existingPrebuiltBinaryMustMatchBuildOptions: true
});
const model = await llama.loadModel({
	useMmap: false,
	useMlock: false,
	modelPath: "./local/models/Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf",
	gpuLayers: 32
});

const bos = model.tokens.bosString || "<|im_start|>";
const eos = model.tokens.eosString || "<|im_end|>";

//////////////////////////////////////////////////
// HTTP Server
//////////////////////////////////////////////////

const httpServer = http.createServer({
	noDelay: false,
	keepAlive: false,
	maxHeaderSize: 8192,
	requestTimeout: 15000,
}, void 0);

httpServer.listen(80, "0.0.0.0", 255, () => {
 	let address = httpServer.address() || "unknown address";
	if (typeof address !== "string")
		address = address.address + ":" + address.port;
	console.log("HTTP server started on " + address);
});

httpServer.on("request", requestCB);
httpServer.on("upgrade", upgradeCB);
httpServer.on("error", errorCB);

//////////////////////////////////////////////////
// socket.io
//////////////////////////////////////////////////

const io = new Server(httpServer, {
	path: "/__api_/",
	cors: {
		origin: true,
		maxAge: 7200,
		methods: ["GET", "HEAD"],
		credentials: false,
		optionsSuccessStatus: 200
	},
	pingTimeout: 10000,
	pingInterval: 15000,
	connectTimeout: 20000,
	upgradeTimeout: 5000,
	httpCompression: true,
	perMessageDeflate: true,
	maxHttpBufferSize: 30000000,
	destroyUpgrade: true,
	destroyUpgradeTimeout: 1000,
	cleanupEmptyChildNamespaces: true
});
io.on("connection", (socket) => {
	let endSession: (() => void) | undefined;

	socket.on("error", errorCB);
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
		const dataDir = "./local/sessions/" + Date.now().toString(16);
		width = Math.max(Math.min(width, landscape ? 1280 : 720), 300);
		height = Math.max(Math.min(height, landscape ? 720 : 1280), 300);

		fs.cpSync("./local/chrome/data", dataDir, {
			force: true,
			recursive: true,
			errorOnExist: true
		});

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
		socket.onAny((...args: any[]) => thread.postMessage(args));

		thread.on("message", (args: [string, ...any]) => socket.emit(...args));
		thread.on("error", (err) => {
			console.error("Worker Error: ", err);
			socket.offAny();
			thread.removeAllListeners();
			try {
				fs.rmSync(dataDir, { force: true, recursive: true });
			} catch (err) { }
			endSession = void 0;
		});
		endSession = () => {
			socket.offAny();
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

	socket.on("fetch", (id, path, data) => {
		if (endSession != null || typeof id !== "string" || typeof path !== "string") {
			socket.disconnect(true);
			return;
		}

		const controller = new AbortController();
		endSession = () => controller.abort();
		handleFetch(path, data, controller.signal)
			.then((data) => {
				endSession = void 0;
				socket.emit("res", id, data);
			}).catch((err) => {
				endSession = void 0;
				socket.emit("res", id, void 0, String(err));
			});
	});

	socket.on("gptreq", async (messages) => {
		if (endSession != null || !Array.isArray(messages)) {
			socket.disconnect(true);
			return;
		}

		try {
			let prompt: string = "";

			for (const e of messages) {
				if (typeof e !== "object")
					throw new Error("Message entry must be an object.");

				const { role, content } = e;
				if (typeof content !== "string")
					throw new Error("Invalid message content: " + content);

				switch (role) {
					case "user":
						prompt += bos + "user\n" + content + eos + "\n";
						break;
					case "assistant":
						prompt += bos + "assistant\n" + content + eos + "\n";
						break;
					default:
						throw new Error("Invalid message role: " + role);
				}
			}

			{
				const length = prompt.length;
				if (length === 0)
					throw new Error("Message must not be empty.");

				if (length > 65536) {
					const i = prompt.indexOf(eos + "\n", length - 65536);
					prompt = i >= 0 ? prompt.slice(i + 11, length) : "";
				}

				prompt += bos + "assistant\n";
			}

			const controller = new AbortController();
			endSession = () => controller.abort();
			const { signal } = controller;
			await gpuLock; gpuLock.lock();
			signal.throwIfAborted();

			const context = await model.createContext({
				seed: 0,
				threads: 4,
				sequences: 1,
				batchSize: 128,
				contextSize: 2048,
				createSignal: signal
			});
			const sequence = context.getSequence({
				contextShift: {
					size: 8192,
					strategy: "eraseBeginning"
				}
			});
			const tokens: Token[] = [];

			for await (const token of sequence.evaluate(model.tokenize(prompt, true), {
				minP: 0,
				topK: 40,
				topP: 0.4,
				temperature: 0.8,
				evaluationPriority: 5
			})) {
				signal.throwIfAborted();
				tokens.push(token);
				socket.emit("gptres", model.detokenize(tokens));
			}

			sequence.dispose();
			await context.dispose();
			socket.emit("gptend");
		} catch (err) {
			console.error("GPT request error: ", err);
			socket.emit("gpterr");
		}

		gpuLock.unlock();
		endSession = void 0;
	});
});
