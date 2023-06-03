#!/bin/env node
import fs from "fs";
import http from "http";
import https from "https";
import Path from "path";
import mime from "./mime.js";
import hosts from "./hosts.js";
import chrome from "./chrome.js";
import { Server } from "socket.io";

/**
 * @param {string} pathname 
 */
function getFilePath(pathname) {
	const path = Path.join("./static", pathname);
	if (fs.existsSync(path)) {
		if (fs.lstatSync(path, { throwIfNoEntry: true, bigint: true }).isDirectory()) {
			for (const f of ["index.html", "index.xht", "index.xml", "index.htm", "index.xhtml", "index.svg"]) {
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

/**
 * @param {string} pathname 
 */
function getGamePath(pathname) {
	if (pathname.startsWith("/games/flash/") || pathname.startsWith("/games/dos/")) {
		const path = "." + pathname;
		if (fs.existsSync(path)) {
			return path;
		}
		return null;
	}

	if (pathname.startsWith("/games/html5/")) {
		const path = "." + pathname;
		if (fs.existsSync(path)) {
			if (fs.lstatSync(path, { throwIfNoEntry: true, bigint: true }).isDirectory()) {
				for (const f of ["index.html", "index.xht", "index.htm", "index.xhtml"]) {
					const p = Path.join(path, f);
					if (fs.existsSync(p))
						return p;
				}
				return null;
			}
			return path;
		}
	}

	return null;
}

/**
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
async function handleRequest(req, res) {
	const method = req.method;
	const rawPath = req.url;
	const headers = req.headers;
	const host = headers.host;

	if (method == null || rawPath == null || host == null) {
		res.writeHead(400, "", { "Content-Type": "text/plain" });
		res.end("Bad Request", "utf-8");
		return;
	}

	const url = new URL(rawPath, "https://" + host);
	const pathname = url.pathname;

	switch (pathname) {
		case "/games/list.txt": {
			res.writeHead(200, "", { "Content-Type": "text/plain" });
			res.end(fs.readFileSync("./games/list.txt"), "utf-8");
			return;
		}
		case "/preview.jpg": {
			const path = "./games/previews/" + url.searchParams.get("game") + ".jpg";
			if (fs.existsSync(path)) {
				res.writeHead(200, "", { "Content-Type": "image/jpeg" });
				res.end(fs.readFileSync(path), "utf-8");
			} else {
				res.writeHead(200, "", { "Content-Type": "image/svg+xml " });
				res.end(fs.readFileSync("./games/preview.svg"), "utf-8");
			}
			return;
		}
		default: {
			const path = pathname.startsWith("/games/") ? getGamePath(pathname) : getFilePath(pathname);
			if (path != null) {
				res.writeHead(200, "", {
					"Content-Type": mime[Path.extname(path)] || "application/octet-stream",
					"Referrer-Policy": "no-referrer",
					"X-Content-Type-Options": "nosniff"
				});
				res.end(fs.readFileSync(path), "utf-8");
			} else {
				res.writeHead(404, "", { "Content-Type": "text/plain" });
				res.end("Not Found", "utf-8");
			}
		}
	}
}

/**
 * @param {http.Server} server 
 */
function bindIO(server) {
	const io = new Server(server, {
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
		socket.setMaxListeners(0);
		socket.on("request_new_session", async (opt) => {
			const { _width, _height, touch, url, tor } = opt;
			if (typeof _width !== "number" ||
				typeof _height !== "number" ||
				typeof touch !== "boolean" ||
				typeof url !== "string" ||
				typeof tor !== "boolean") {
				// invalid client request
				socket.disconnect(true);
				return;
			}

			const landscape = _width > _height;
			const width = Math.max(Math.min(_width, landscape ? 1280 : 720), 300);
			const height = Math.max(Math.min(_height, landscape ? 720 : 1280), 300);

			const context = tor ? await chrome.createIncognitoBrowserContext({
				proxyServer: "socks5://127.0.0.1:9050",
				proxyBypassList: []
			}) : chrome.defaultBrowserContext();

			/**
			 * @typedef {import("puppeteer").Page} Page
			 * @type {Page[]}
			 */
			const pages = [];
			let focused = -1;
			let syncing = false;

			/**
			 * @param {import("puppeteer").HTTPRequest} request 
			 */
			async function interceptHttpRequest(request) {
				try {
					const url = new URL(request.url());
					switch (url.protocol) {
						case "http:":
						case "https:":
							const host = url.hostname;
							if (hosts.includes(host)) { // block ads to save bandwidth
								await request.abort("blockedbyclient");
								return;
							}

							if (host.match(/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/)) {
								const parts = host.split(".", 4); // direct ip access
								switch (parts[0]) {
									case "0": // 0.0.0.0/8
									case "127": // 127.0.0.0/8
									case "10": // 10.0.0.0/8
										await request.abort("connectionclosed");
										return;
									case "192":
										if (parts[1] === "168") { // 192.168.0.0/16
											await request.abort("connectionclosed");
											return;
										}
										break;
									default:
										break;
								}
							}

							await request.continue();
							break;
						case "data:":
						case "blob:":
							await request.continue();
							break;
						default:
							await request.abort("accessdenied");
							break;
					}
				} catch (err) {
					//console.error(err);
				}
			}

			/**
			 * @param {Page} page 
			 */
			async function updatePageSettings(page) {
				try {
					await page.setCacheEnabled(true);
					await page.setJavaScriptEnabled(true);
					await page.setRequestInterception(true);
					await page.setGeolocation({
						accuracy: 0,
						latitude: 0,
						longitude: 0
					});
					await page.setUserAgent("Mozilla/5.0 ( ; ; rv:109.0) Gecko/20100101 Firefox/115.0", {
						architecture: "",
						bitness: "",
						brands: [],
						fullVersion: "",
						fullVersionList: [],
						mobile: false,
						model: "",
						platform: "",
						platformVersion: "",
						wow64: false
					});
					await page.setViewport({
						width: width,
						height: height,
						hasTouch: touch,
						isLandscape: landscape,
						isMobile: false,
						deviceScaleFactor: 1
					});

					// event listeners
					page.on("close", () => {
						const index = pages.indexOf(page);
						if (index >= 0) {
							socket.emit("tabclose", index);
							pages.splice(index, 1);
							if (focused >= pages.length)
								focused--;
						}
					});
					page.on("popup", async (page) => {
						await updatePageSettings(page);
						pages.push(page);
						socket.emit("tabopen", ++focused);
					});
					page.on("request", interceptHttpRequest);
				} catch (err) {
					//console.error(err);
				}
			}

			async function newTab() {
				const page = await context.newPage();
				updatePageSettings(page);
				pages.push(page);
				socket.emit("tabopen", ++focused);
			}

			/**
			 * @param {string} url 
			 */
			async function navigate(url) {
				try {
					await pages[focused].goto(url, {
						referer: "",
						timeout: 10000,
						waitUntil: "domcontentloaded"
					});
				} catch (err) {
					//console.error(err);
				}
			}

			async function goBack() {
				try {
					await pages[focused].goBack({
						timeout: 10000,
						waitUntil: "domcontentloaded"
					});
				} catch (err) {
					//console.error(err);
				}
			}

			async function goForward() {
				try {
					await pages[focused].goForward({
						timeout: 10000,
						waitUntil: "domcontentloaded"
					});
				} catch (err) {
					//console.error(err);
				}
			}

			async function refresh() {
				try {
					await pages[focused].reload({
						timeout: 10000,
						waitUntil: "domcontentloaded"
					});
				} catch (err) {
					//console.error(err);
				}
			}

			/**
			 * @typedef {{ readonly type: "mousedown" | "mouseup" | "mousemove"; readonly x: number; readonly y: number; readonly button: import("puppeteer").MouseButton; }} MouseEvent
			 * @typedef {{ readonly type: "touchstart" | "touchend" | "touchmove"; readonly x: number; readonly y: number; }} TouchEvent
			 * @typedef {{ readonly type: "wheel"; readonly deltaX: number; readonly deltaY: number; }} WheelEvent
			 * @typedef {{ readonly type: "keydown" | "keyup"; readonly key: import("puppeteer").KeyInput; }} KeyboardEvent
			 * @param {MouseEvent | TouchEvent | WheelEvent | KeyboardEvent} event 
			 */
			async function dispatchEvent(event) {
				try {
					switch (event.type) {
						case "mousedown":
							await pages[focused].mouse.down({ button: event.button });
							break;
						case "mouseup":
							await pages[focused].mouse.up({ button: event.button });
							break;
						case "mousemove":
							await pages[focused].mouse.move(event.x, event.y, { steps: 1 });
							break;
						case "wheel":
							await pages[focused].mouse.wheel({ deltaX: event.deltaX, deltaY: event.deltaY });
							break;
						case "touchstart":
							await pages[focused].touchscreen.touchStart(event.x, event.y);
							break;
						case "touchend":
							await pages[focused].touchscreen.touchEnd();
							break;
						case "touchmove":
							await pages[focused].touchscreen.touchMove(event.x, event.y);
							break;
						case "keydown":
							await pages[focused].keyboard.down(event.key);
							break;
						case "keyup":
							await pages[focused].keyboard.up(event.key);
							break;
						default:
							console.warn("Unknown event: " + event);
							break;
					}
				} catch (err) {
					//console.error(err);
				}
			}

			async function sync() {
				const page = pages[focused];

				try {
					return {
						url: page.url(),
						tabId: focused,
						title: await page.title(),
						buffer: await page.screenshot({
							type: "jpeg",
							quality: 70,
							encoding: "base64",
							fullPage: false,
							fromSurface: true,
							omitBackground: true
						})
					};
				} catch (err) {
					//console.error(err);
					return null;
				}
			}

			/**
			 * @param {number} id 
			 */
			async function closeTab(id) {
				try {
					if (id === 0) return;
					await pages[id].close({ runBeforeUnload: false });
				} catch (err) {
					//console.error(err);
				}
			}

			async function endSession() {
				try {
					for (const page of pages) {
						page.removeAllListeners();
						await page.close({ runBeforeUnload: false });
					}
					pages.length = 0;
				} catch (err) {
					//console.error(err);
				}
			}

			socket.on("navigate", navigate);
			socket.on("goback", goBack);
			socket.on("goforward", goForward);
			socket.on("refresh", refresh);
			socket.on("event", dispatchEvent);
			socket.on("newtab", newTab);
			socket.on("focustab", (i) => focused = i);
			socket.on("closetab", closeTab);

			socket.on("sync", async () => {
	/**/		if (syncing)
	/**/		return;
	/**/		syncing = true;
	/**/		const data = await sync();
	/**/		if (data != null)
	/**/		socket.emit("data", data);
	/**/		syncing = false;
			});

			socket.on("disconnect", async () => {
				await endSession();
				socket.removeAllListeners();
				socket.disconnect(true);
			});

			await newTab();
			if (url.length > 0)
				await navigate(url);
			socket.emit("session_ready", { width, height });
		});
	});
}

function requestCallback(req, res) {
	handleRequest(req, res).catch(err => {
		console.error(err);
		res.writeHead(500, "", { "Content-Type": "text/plain" });
		res.end("Internal Server Error", "utf-8");
	});
}

function upgradeCallback(req, socket, head) {
	socket.end("Forbidden", "utf-8");
}

const httpServer = http.createServer();
httpServer.on("request", requestCallback);
httpServer.on("upgrade", upgradeCallback);
httpServer.listen(80, "0.0.0.0", () => {
	const addr = httpServer.address();
	console.log(`HTTP server started on ${addr.address}:${addr.port}`);
});
bindIO(httpServer);

const httpsServer = https.createServer({ cert: fs.readFileSync("/etc/localhost.crt", "utf-8"), key: fs.readFileSync("/etc/localhost.key", "utf-8") }, void 0);
httpsServer.on("request", requestCallback);
httpsServer.on("upgrade", upgradeCallback);
httpsServer.listen(443, "0.0.0.0", () => {
	const addr = httpsServer.address();
	console.log(`HTTPS server started on ${addr.address}:${addr.port}`);
});
bindIO(httpsServer);
