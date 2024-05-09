import fs from "fs";
import dns from "dns";
import url from "url";
import Path from "path"
import http from "http";
import crypto from "crypto";
import worker from "worker_threads";
import AsyncLock from "./AsyncLock.js";
import * as discord from "discord.js";
import { Server, Socket } from "socket.io";
import { Token, getLlama } from "node-llama-cpp";

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

async function fetchBuffer(url: string | URL, signal: AbortSignal): Promise<ArrayBuffer | null> {
	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				"Accept": "application/json"
			},
			signal: signal
		});
		return res.ok ? await res.arrayBuffer() : null;
	} catch (err) {
		console.error(err);
		return null;
	}
}

async function handleLogin(token: string, signal: AbortSignal): Promise<string> {
	if (typeof token !== "string" || token.length === 0)
		throw new Error("Invalid token");

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

		const avatar: ArrayBuffer | null = await fetchBuffer(user.picture, signal);
		if (avatar != null) {
			fs.writeFileSync("./local/avatar/" + uid + ".jpg", Buffer.from(avatar), {
				mode: 0o600,
				flush: true
			});
		}

		return secrets;
	}

	return list[id].secrets;
}

async function handleLogin2(user: string, pass: string, signal: AbortSignal): Promise<string> {
	if (typeof user !== "string" || (user = user.trim().toLowerCase()).length < 4 || user.length > 20 || !/^[\-a-z0-9]+$/.test(user))
		throw new Error("Invalid user ID");
	if (typeof pass !== "string" || pass.length < 8 || pass.length > 30)
		throw new Error("Invalid password");

	const info = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}))[user];

	if (info == null)
		throw new Error("User does not exist: " + user);

	const password = info.password;
	if (password == null || password !== pass)
		throw new Error("Incorrect password");

	return info.secrets;
}

async function handleRegister(user: string, pass: string, signal: AbortSignal): Promise<string> {
	if (typeof user !== "string" || (user = user.trim().toLowerCase()).length < 4 || user.length > 20 || !/^[\-a-z0-9]+$/.test(user))
		throw new Error("Invalid user ID");
	if (typeof pass !== "string" || pass.length < 8 || pass.length > 30)
		throw new Error("Invalid password");

	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	if (user in list)
		throw new Error("User already exists: " + user);

	// generate account secrets
	let secrets: string = "";
	for (const ch of crypto.getRandomValues(new Uint8Array(new ArrayBuffer(1024), 0, 1024)))
		secrets += ch.toString(16).padStart(2, "0");

	// generate uid
	const uid = Date.now().toString(10);

	list[user] = {
		vip: null,
		uid: uid,
		name: "",
		email: "",
		secrets: secrets,
		password: pass
	};
	fs.writeFileSync("./local/users.json", JSON.stringify(list, void 0, "\t"), {
		mode: 0o600,
		flush: true,
		encoding: "utf-8"
	});

	return secrets;
}

function handleUserInfoSync(uid: string): any {
	const list = JSON.parse(fs.readFileSync("./local/users.json", "utf-8"));

	let info = null;

	for (const k of Object.keys(list)) {
		const v = list[k];
		if (v.uid === uid) {
			v.id = k;
			info = v;
			break;
		}
	}

	const avatar = "./local/avatar/" + uid + ".jpg";

	return {
		id: info.id,
		//uid: info.uid,
		vip: info.vip,
		avatar: fs.readFileSync(fs.existsSync(avatar) ? avatar : "./res/user.png")
	};
}

async function handleUserInfo(uid: string, signal: AbortSignal): Promise<any> {
	if (typeof uid !== "string" || uid.length === 0)
		throw new Error("Invalid UID");

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

	const avatar = "./local/avatar/" + uid + ".jpg";

	return {
		id: info.id,
		uid: info.uid,
		vip: info.vip,
		avatar: await fs.promises.readFile(fs.existsSync(avatar) ? avatar : "./res/user.png", {
			signal: signal
		})
	};
}

async function handleUserData(secrets: string, signal: AbortSignal): Promise<any> {
	if (typeof secrets !== "string" || secrets.length !== 2048)
		throw new Error("Invalid token");

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
	const avatar = "./local/avatar/" + uid + ".jpg";

	return {
		id: info.id,
		uid: uid,
		vip: info.vip,
		name: info.name,
		email: info.email,
		avatar: await fs.promises.readFile(fs.existsSync(avatar) ? avatar : "./res/user.png", {
			signal: signal
		})
	};
}

async function handleChangeId(secrets: string, newId: string, signal: AbortSignal): Promise<void> {
	if (typeof secrets !== "string" || secrets.length !== 2048)
		throw new Error("Invalid token");
	if (typeof newId !== "string" || (newId = newId.trim().toLowerCase()).length < 4 || newId.length > 20 || !/^[\-a-z0-9]+$/.test(newId))
		throw new Error("Invalid new ID");

	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	if (newId in list)
		throw new Error("User already exists: " + newId);

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
	if (typeof secrets !== "string" || secrets.length !== 2048)
		throw new Error("Invalid token");
	if (!ArrayBuffer.isView(img) || img.byteLength < 1 || img.byteLength > 2097152)
		throw new Error("Invalid image data");

	let uid: string | null = null;

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
	}

	if (uid == null)
		throw new Error("Invalid credentials");

	fs.writeFileSync("./local/avatar/" + uid + ".jpg", img, {
		mode: 0o600,
		flush: true
	});
}

async function handleChangePassword(secrets: string, curPass: string, newPass: string, signal: AbortSignal): Promise<void> {
	if (typeof secrets !== "string" || secrets.length !== 2048)
		throw new Error("Invalid token");
	if (typeof curPass !== "string" || curPass.length < 8 || curPass.length > 30)
		throw new Error("Invalid password");
	if (typeof newPass !== "string" || newPass.length < 8 || newPass.length > 30)
		throw new Error("Invalid password");

	const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
		signal: signal,
		encoding: "utf-8"
	}));

	let info = null;

	for (const k of Object.keys(list)) {
		const v = list[k];
		if (v.secrets === secrets) {
			info = v;
			break;
		}
	}

	if (info == null)
		throw new Error("Invalid credentials");

	{
		const p = info.password;
		if ((p == null && curPass !== "CHANGEME!") || (p != null && curPass !== p))
			throw new Error("Incorrect current password");

		info.password = newPass;
	}

	fs.writeFileSync("./local/users.json", JSON.stringify(list, void 0, "\t"), {
		mode: 0o600,
		flush: true,
		encoding: "utf-8"
	});
}

async function handleRequestMessages(chId: string, bef: string | undefined, aft: string | undefined, signal: AbortSignal): Promise<any> {
	if (typeof chId !== "string" || chId.length === 0)
		throw new Error("Invalid channel ID");

	const channel = await client.channels.fetch(chId, {
		cache: true,
		force: true,
		allowUnknownGuild: false
	});

	if (channel == null)
		throw new Error("Failed to resolve channel: " + chId);

	switch (channel.type) {
		case discord.ChannelType.GuildText:
		case discord.ChannelType.PublicThread:
		case discord.ChannelType.PrivateThread:
			break;
		default:
			throw new Error("Unsupported channel type: " + channel.type);
	}

	const messages: Message[] = [];

	for (const msg of (await channel.messages.fetch({
		before: bef,
		after: aft,
		limit: 20,
		cache: true
	})).values()) {
		const text = msg.content.trim();
		const msgId = msg.id;
		const author = msg.author;

		const files: MessageFile[] = [];
		for (const f of msg.attachments.values()) {
			files.push({
				type: f.contentType || "application/octet-stream",
				name: f.name,
				url: f.url
			});
		}

		if (author.id === user.id) {
			const uid = JSON.parse(await fs.promises.readFile("./local/msgs.json", {
				signal: signal,
				encoding: "utf-8"
			}))[msg.id];

			if (uid != null) {
				const { id, vip, avatar } = await handleUserInfo(uid, signal);
				messages.push({
					id: msgId,
					msg: text.slice(text.indexOf("\n") + 1),
					vip: vip,
					uid: uid,
					user: id,
					icon: avatar,
					files: files
				});
			}
		} else {
			messages.push({
				id: msgId,
				msg: text,
				user: author.username,
				icon: author.avatarURL({
					size: 64,
					extension: "jpg",
					forceStatic: true
				}) || "/res/user.svg",
				files: files
			});
		}
	}

	return messages;
}

async function handlePostFileMessage(secrets: string, chId: string, files: any[], signal: AbortSignal): Promise<void> {
	if (typeof secrets !== "string" || secrets.length !== 2048)
		throw new Error("Invalid token");
	if (typeof chId !== "string" || chId.length === 0)
		throw new Error("Invalid channel ID");
	if (!Array.isArray(files) || files.length < 1 || files.length > 10)
		throw new Error("Invalid attachment data");

	let uid: string | null = null;
	let vip: number | null = null;
	let user: string | null = null;

	{
		const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
			signal: signal,
			encoding: "utf-8"
		}));

		for (const k of Object.keys(list)) {
			const v = list[k];
			if (v.secrets === secrets) {
				uid = v.uid;
				vip = v.vip;
				user = k;
				break;
			}
		}
	}

	if (uid == null)
		throw new Error("Invalid credentials");
	if (user == null)
		throw new Error("User data is corrupted: " + uid);

	const channel = await client.channels.fetch(chId, {
		cache: true,
		force: true,
		allowUnknownGuild: false
	});

	if (channel == null)
		throw new Error("Failed to resolve channel: " + chId);
	if (channel.type !== discord.ChannelType.GuildText || !channel.nsfw)
		throw new Error("Invalid channel for posting files.");

	const msg = await channel.send({
		files: files,
		content: "",
		allowedMentions: {
			parse: [],
			roles: [],
			users: []
		}
	});

	const msgId = msg.id;
	const avatar = "./local/avatar/" + uid + ".jpg";
	const avatarBuf = fs.readFileSync(fs.existsSync(avatar) ? avatar : "./res/user.png");

	files.length = 0;
	for (const f of msg.attachments.values()) {
		files.push({
			type: f.contentType || "application/octet-stream",
			name: f.name,
			url: f.url
		});
	}

	for (const socket of chatSockets) {
		socket.emit("msg", chId, {
			id: msgId,
			msg: "",
			uid: uid,
			vip: vip,
			user: user,
			icon: avatarBuf,
			files: files
		});
	}

	{
		const list = JSON.parse(fs.readFileSync("./local/msgs.json", "utf-8"));
		list[msgId] = uid;
		fs.writeFileSync("./local/msgs.json", JSON.stringify(list, void 0, "\t"), {
			mode: 0o600,
			flush: true,
			encoding: "utf-8"
		});
	}
}

async function handlePostMessage(secrets: string, chId: string, text: string, signal: AbortSignal): Promise<void> {
	if (typeof secrets !== "string" || secrets.length !== 2048)
		throw new Error("Invalid token");
	if (typeof chId !== "string" || chId.length === 0)
		throw new Error("Invalid channel ID");
	if (typeof text !== "string" || ((text = text.trim())).length === 0)
		throw new Error("Invalid message");

	let uid: string | null = null;
	let vip: number | null = null;
	let user: string | null = null;

	{
		const list = JSON.parse(await fs.promises.readFile("./local/users.json", {
			signal: signal,
			encoding: "utf-8"
		}));

		for (const k of Object.keys(list)) {
			const v = list[k];
			if (v.secrets === secrets) {
				uid = v.uid;
				vip = v.vip;
				user = k;
				break;
			}
		}
	}

	if (uid == null)
		throw new Error("Invalid credentials");
	if (user == null)
		throw new Error("User data is corrupted: " + uid);

	const channel = await client.channels.fetch(chId, {
		cache: true,
		force: true,
		allowUnknownGuild: false
	});

	if (channel == null)
		throw new Error("Failed to resolve channel: " + chId);

	switch (channel.type) {
		case discord.ChannelType.GuildText:
		case discord.ChannelType.PublicThread:
		case discord.ChannelType.PrivateThread:
			break;
		default:
			throw new Error("Unsupported channel type: " + channel.type);
	}

	const msgId = (await channel.send({
		content: "**" + user + ":**\n" + text,
		allowedMentions: {
			parse: [],
			roles: [],
			users: []
		}
	})).id;

	const avatar = "./local/avatar/" + uid + ".jpg";
	const avatarBuf = fs.readFileSync(fs.existsSync(avatar) ? avatar : "./res/user.png");

	for (const socket of chatSockets) {
		socket.emit("msg", chId, {
			id: msgId,
			msg: text,
			uid: uid,
			vip: vip,
			user: user,
			icon: avatarBuf,
			files: []
		});
	}

	{
		const list = JSON.parse(fs.readFileSync("./local/msgs.json", "utf-8"));
		list[msgId] = uid;
		fs.writeFileSync("./local/msgs.json", JSON.stringify(list, void 0, "\t"), {
			mode: 0o600,
			flush: true,
			encoding: "utf-8"
		});
	}
}

async function handleFetch(path: SIOPath, data: any, signal: AbortSignal): Promise<any> {
	switch (path) {
		case SIOPath.login:
			return await handleLogin(data, signal);
		case SIOPath.login2:
			return await handleLogin2(data[0], data[1], signal);
		case SIOPath.register:
			return await handleRegister(data[0], data[1], signal);
		case SIOPath.userinfo:
			return await handleUserInfo(data, signal);
		case SIOPath.userdata:
			return await handleUserData(data, signal);
		case SIOPath.changeid:
			return await handleChangeId(data[0], data[1], signal);
		case SIOPath.changeavatar:
			return await handleChangeAvatar(data[0], data[1], signal);
		case SIOPath.changePassword:
			return await handleChangePassword(data[0], data[1], data[2], signal);
		case SIOPath.requestmessages:
			return await handleRequestMessages(data[0], data[1], data[2], signal);
		case SIOPath.postFileMessage:
			return await handlePostFileMessage(data[0], data[1], data[2], signal);
		case SIOPath.postmessage:
			return await handlePostMessage(data[0], data[1], data[2], signal);
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
fs.mkdirSync("./local/games", { mode: 0o700, recursive: true });
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
// Discord Bot
//////////////////////////////////////////////////

const client = new discord.Client<true>({
	intents: 33280,
	closeTimeout: 2000,
	failIfNotExists: true,
	waitGuildTimeout: 5000
});

await client.login("MTIxNzE3MjE0Mjk0MTI3ODM2OA.GaNK5a.jTaZ-4b71zCAR3pnsLB-ZS4v6SMm3leh5HSx6E");
await new Promise((resolve) => {
	client.once("ready", resolve);
});

const user = client.user;
try {
	await user.setBanner("./res/banner.png");
	await user.setAvatar("./res/logo512.png");
	await user.setUsername("WhiteSpider\ud83d\udc51");
} catch (err) {
}

user.setPresence({
	afk: true,
	status: "idle",
	shardId: 0,
	activities: [
		{
			url: "https://whitespider.dev/",
			name: "Loading...",
			type: discord.ActivityType.Custom,
			state: "Online",
		}
	]
});
console.log("Logged in as " + user.tag);

const chatSockets: Socket[] = [];

client.on("messageCreate", (msg) => {
	const text = msg.content.trim();
	const msgId = msg.id;
	const author = msg.author;
	const channel = msg.channelId;

	const files: MessageFile[] = [];
	for (const f of msg.attachments.values()) {
		files.push({
			type: f.contentType || "application/octet-stream",
			name: f.name,
			url: f.url
		});
	}

	if (author.id === user.id) {
		const uid = JSON.parse(fs.readFileSync("./local/msgs.json", "utf-8"))[msgId];
		if (uid != null) {
			const { id, vip, avatar } = handleUserInfoSync(uid);
			const content = text.slice(text.indexOf("\n") + 1);

			for (const socket of chatSockets) {
				socket.emit("msg", channel, {
					id: msgId,
					msg: content,
					uid: uid,
					vip: vip,
					user: id,
					icon: avatar,
					files: files
				});
			}
		}
	} else {
		const user = author.username;
		const icon = author.avatarURL({
			size: 64,
			extension: "jpg",
			forceStatic: true
		}) || "/res/user.svg";

		for (const socket of chatSockets) {
			socket.emit("msg", channel, {
				id: msgId,
				msg: text,
				user: user,
				icon: icon,
				files: files
			});
		}
	}
});
client.on("messageDelete", (msg) => {
	const msgId = msg.id;
	const channel = msg.channelId;

	for (const socket of chatSockets)
		socket.emit("msgdel", channel, msgId);
});
client.on("messageUpdate", (omsg, nmsg) => {
	const text = (nmsg.content || "").trim();
	const msgId = omsg.id;
	const channel = omsg.channelId;

	for (const socket of chatSockets)
		socket.emit("msgupd", channel, msgId, text);
});

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

const _io_ = new Server(httpServer, {
	path: "/_api_/",
	cors: {
		origin: true,
		maxAge: 7200,
		methods: ["GET", "HEAD"],
		credentials: false
	},
	pingTimeout: 10000,
	pingInterval: 15000,
	connectTimeout: 20000,
	upgradeTimeout: 10000,
	httpCompression: true,
	perMessageDeflate: true,
	maxHttpBufferSize: 28000000,
	destroyUpgrade: true,
	destroyUpgradeTimeout: 1000,
	cleanupEmptyChildNamespaces: true
});
_io_.on("connection", (socket) => {
	let endSession: (() => void) | undefined;

	socket.on("error", (err) => {
		console.error("socket error: ", err);
		socket.disconnect(true);
		if (endSession != null)
			endSession();
	});
	socket.on("end_session", () => {
		if (endSession != null)
			endSession();
	});
	socket.on("disconnect", () => {
		socket.disconnect(true);
		if (endSession != null)
			endSession();
	});

	socket.on("ns", (options) => {
		if (endSession != null || options == null || typeof options !== "object") {
			socket.disconnect(true);
			return;
		}

		const { width, height, touch } = options;
		if (typeof width !== "number" || typeof height !== "number" || typeof touch !== "boolean") {
			socket.disconnect(true);
			return;
		}

		const landscape = width > height;
		const dataDir = "./local/sessions/" + Date.now().toString(16);

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
				width: Math.max(Math.min(width, landscape ? 1280 : 720), 300),
				height: Math.max(Math.min(height, landscape ? 720 : 1280), 300),
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
		const callback = (...args: any[]) => {
			thread.postMessage(args);
		};

		socket.onAny(callback);
		thread.on("message", (args: [string, ...any]) => {
			socket.emit(...args);
		});
		thread.on("error", (err) => {
			console.error("Worker Error: ", err);
			socket.offAny(callback);
			thread.removeAllListeners();
			try {
				fs.rmSync(dataDir, {
					force: true,
					recursive: true,
					maxRetries: 10,
					retryDelay: 500
				});
			} catch (err) { }
			endSession = void 0;
		});
		thread.on("exit", () => {
			socket.offAny(callback);
			thread.removeAllListeners();
			try {
				fs.rmSync(dataDir, {
					force: true,
					recursive: true,
					maxRetries: 10,
					retryDelay: 500
				});
			} catch (err) { }
			endSession = void 0
		});
		endSession = () => {
			socket.offAny(callback);
			thread.removeAllListeners();
			thread.postMessage(["stop"]);
		};
	});

	socket.on("ncs", () => {
		if (endSession != null) {
			socket.disconnect(true);
			return;
		}

		endSession = () => {
			const i = chatSockets.indexOf(socket);
			if (i >= 0)
				chatSockets.splice(i, 1);

			endSession = void 0;
		};

		chatSockets.push(socket);
	});

	socket.on("fetch", (id, path, data) => {
		if (typeof id !== "string" || typeof path !== "number") {
			socket.disconnect(true);
			return;
		}

		const controller = new AbortController();
		const callback = () => controller.abort();
		socket.on("disconnect", callback);

		handleFetch(path, data, controller.signal)
			.then((data) => {
				socket.off("disconnect", callback);
				socket.emit("res", id, data);
			}).catch((err) => {
				console.error(err);
				socket.off("disconnect", callback);
				socket.emit("res", id, void 0, String(err));
			});
	});

	socket.on("ug", (secrets: string, name: string, type: string, tags: string, desc: string, buffer: Buffer) => {
		if (endSession != null || typeof secrets !== "string" || secrets.length !== 2048 ||
			typeof name !== "string" || (name = name.trim()).length < 1 || name.length > 256 ||
			typeof tags !== "string" || (tags = tags.toLowerCase().trim()).length > 300 ||
			typeof desc !== "string" || (desc = desc.trim()).length > 5000 ||
			!ArrayBuffer.isView(buffer) || buffer.byteLength < 1 || buffer.byteLength > 26214400) {
			socket.disconnect(true);
			return;
		}

		let uid: string | undefined;
		let ext: string | undefined;

		switch (type) {
			case "html5":
				ext = ".zip";
				break;
			case "flash":
				ext = ".swf";
				break;
			case "dos":
				ext = ".jsdos";
				break;
			default:
				socket.disconnect(true);
				return;
		}

		{
			const list = JSON.parse(fs.readFileSync("./local/users.json", "utf-8"))
			for (const k of Object.keys(list)) {
				const v = list[k];
				if (v.secrets === secrets) {
					uid = v.uid;
					break;
				}
			}
		}

		if (uid == null) {
			socket.disconnect(true);
			return;
		}

		const file = Path.join("/games/", type, name.toLowerCase().replace(/[^0-9a-z\-]/g, (ch) => {
			switch (ch) {
				case "-":
				case " ":
				case "\t":
				case "\n":
					return "-";
				default:
					return "";
			}
		}) + ext);

		{
			const absFile = Path.join("./local/", file);
			if (fs.existsSync(absFile)) {
				socket.emit("ugerr", "A game with the same name and label already exists.");
				return;
			}

			fs.writeFileSync(absFile, buffer, {
				mode: 0o600,
				flush: true
			});

			const list = JSON.parse(fs.readFileSync("./local/games/index.json", "utf-8"));
			list.push({
				name: name,
				type: type,
				tags: tags,
				desc: desc,
				file: file,
				date: Date.now(),
				user: uid
			});
			fs.writeFileSync("./local/games/index.json", JSON.stringify(list, void 0, "\t"), {
				mode: 0o600,
				flush: true,
				encoding: "utf-8"
			});

			socket.emit("ugend");
		}
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

				const { role, text } = e;
				if (typeof text !== "string")
					throw new Error("Invalid message text: " + text);

				switch (role) {
					case "u":
						prompt += bos + "user\n" + text + eos + "\n";
						break;
					case "a":
						prompt += bos + "assistant\n" + text + eos + "\n";
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
			const signal = controller.signal;
			endSession = () => controller.abort();
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
			console.error(err);
			socket.emit("gpterr", String(err));
		}

		gpuLock.unlock();
		endSession = void 0;
	});

	// socket.on("netreq", async (id: string, url: string | URL, method: string, headers: any) => {
	// 	if (typeof url !== "string" || typeof method !== "string" || headers == null || typeof headers !== "object") {
	// 		socket.disconnect(true);
	// 		return;
	// 	}

	// 	const controller = new AbortController();
	// 	const signal = controller.signal;

	// 	const disCb = () => controller.abort();
	// 	socket.on("disconnect", disCb);

	// 	let outgoing: http.ClientRequest;

	// 	switch ((url = new URL(url)).protocol) {
	// 		case "http:":
	// 			outgoing = http.request({
	// 				protocol: "http:",
	// 				host: url.host,
	// 				port: url.port,
	// 				path: url.href.slice(url.origin.length),
	// 				signal: signal,
	// 				method: method,
	// 				headers: headers,
	// 				setHost: true
	// 			});
	// 			break;
	// 		case "https:":
	// 			outgoing = https.request({
	// 				protocol: "https:",
	// 				host: url.host,
	// 				port: url.port,
	// 				path: url.href.slice(url.origin.length),
	// 				signal: signal,
	// 				method: method,
	// 				headers: headers,
	// 				setHost: true
	// 			});
	// 			break;
	// 		default:
	// 			throw new Error("Unsupport URL protocol: " + url.protocol);
	// 	}

	// 	{
	// 		const dataCb = (msgId: string, data: ArrayBufferView) => {
	// 			if (msgId === id)
	// 				outgoing.write(data);
	// 		};
	// 		const endCb = (msgId: string) => {
	// 			if (msgId === id) {
	// 				socket.off("data", dataCb);
	// 				socket.off("end", endCb);
	// 				outgoing.end();
	// 			}
	// 		};

	// 		socket.on("data", dataCb);
	// 		socket.on("end", endCb);
	// 	}

	// 	outgoing.on("response", (res) => {
	// 		socket.off("disconnect", disCb);

	// 		const headers: Record<string, any> = res.headers;
	// 		for (const k of Object.keys(headers)) {
	// 			const v = headers[k];
	// 			if (typeof v === "string")
	// 				headers[k] = [v];
	// 		}
	// 		socket.emit("head", id, res.statusCode || 200, res.statusMessage || "", headers);

	// 		const abortCb = (msgId: string) => {
	// 			if (msgId === id) {
	// 				res.removeAllListeners();
	// 				res.destroy();

	// 				socket.off("abort", abortCb);
	// 				controller.abort();
	// 			}
	// 		};
	// 		socket.on("abort", abortCb);
	// 		socket.on("disconnect", abortCb);

	// 		res.on("error", (err) => {
	// 			socket.off("disconnect", abortCb);
	// 			socket.off("abort", abortCb);
	// 			res.removeAllListeners();
	// 			res.destroy();

	// 			console.error("Response read error: ", err);
	// 			socket.emit("err", id, String(err));
	// 		});
	// 		res.on("data", (data) => {
	// 			socket.emit("data", id, data);
	// 		});
	// 		res.on("end", () => {
	// 			res.removeAllListeners();
	// 			res.destroy();

	// 			socket.off("disconnect", abortCb);
	// 			socket.off("abort", abortCb);
	// 			socket.emit("end", id);
	// 		});
	// 	});
	// 	outgoing.on("upgrade", (res, dup, head) => {
	// 		res.destroy();
	// 		dup.destroy();
	// 		socket.emit("err", id, "Invalid remote response");
	// 	});
	// 	outgoing.on("error", (err) => {
	// 		console.error("Network request error: ", err);
	// 		socket.emit("err", id, String(err));
	// 	});
	// });
});
