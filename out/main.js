import fs from "fs";
import dns from "dns";
import http from "http";
import https from "https";
import Path from "path";
import mime from "./mime.js";
import process from "process";
import puppeteer from "puppeteer";
import { Server } from "socket.io";
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
    if (path == null || !path.startsWith("/mortes/"))
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
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
fs.mkdirSync("./local/chrome", { mode: 0o700, recursive: true });
fs.mkdirSync("./local/data", { mode: 0o700, recursive: true });
const chrome = await puppeteer.launch({
    pipe: false,
    dumpio: true,
    timeout: 10000,
    product: "chrome",
    channel: "chrome",
    headless: "new",
    userDataDir: "./local/data/",
    executablePath: "./local/chrome/chrome",
    defaultViewport: {
        width: 1280,
        height: 720,
        isMobile: false,
        hasTouch: false,
        isLandscape: true,
        deviceScaleFactor: 1
    },
    args: [
        "--no-sandbox",
        "--no-first-run",
        "--disable-gpu",
        "--disable-sync",
        "--disable-logging",
        "--disable-infobars",
        "--disable-translate",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-notifications",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--disable-background-networking",
        "--window-size=1280,720",
        "--window-position=0,0"
    ]
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
    path: "/mortes/",
    cors: {
        origin: ["http://localhost:8000", "https://whitespider.gq", "https://whitespider.eu.org"],
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
const sessions = [];
class Session {
    socket;
    #context;
    #pages = [];
    #width;
    #height;
    #touch;
    #landscape;
    #focused = -1;
    get #focusedPage() { return this.#pages[this.#focused]; }
    set #focusedPage(page) { this.#pages[this.#focused] = page; }
    constructor(socket, context, width, height, touch, landscape) {
        this.socket = socket;
        this.#context = context;
        this.#width = width;
        this.#height = height;
        this.#touch = touch;
        this.#landscape = landscape;
    }
    async #updatePageSettings(page) {
        await page.setBypassCSP(true);
        await page.setCacheEnabled(true);
        await page.setJavaScriptEnabled(true);
        await page.setGeolocation({
            accuracy: 0,
            latitude: 0,
            longitude: 0
        });
        await page.setUserAgent("Mozilla/5.0 ( ; ; rv:121.0) Gecko/20100101 Firefox/121.0", {
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
            width: this.#width,
            height: this.#height,
            hasTouch: this.#touch,
            isLandscape: this.#landscape,
            isMobile: false,
            deviceScaleFactor: 1
        });
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(7500);
        // event listeners
        page.on("load", async () => {
            try {
                const index = this.#pages.indexOf(page);
                if (index >= 0) {
                    this.socket.emit("tabinfo", {
                        id: index,
                        title: await page.title(),
                        favicon: await loadFavicon(page)
                    });
                    this.socket.emit("url", this.#focusedPage.url());
                }
            }
            catch (err) { }
        });
        page.on("close", () => {
            page.removeAllListeners();
            const pages = this.#pages;
            const index = pages.indexOf(page);
            if (index >= 0) {
                pages.splice(index, 1);
                if (this.#focused >= pages.length)
                    this.#focused--;
                this.socket.emit("tabclose", index);
                this.socket.emit("url", this.#focusedPage.url());
            }
        });
        page.on("popup", (page) => {
            if (page != null) {
                this.#updatePageSettings(page).catch(() => void 0);
                this.#pages.push(page);
                this.socket.emit("tabopen", ++this.#focused);
                this.socket.emit("url", page.url());
            }
        });
        page.on("framenavigated", (frame) => {
            if (!frame.detached && frame.parentFrame() == null)
                this.socket.emit("url", page.url());
        });
    }
    #checkRewriteURL(url) {
        switch (url.protocol) {
            case "http:":
            case "https:":
            case "data:":
                break;
            default:
                return "about:blank";
        }
        const { hostname } = url;
        if (hostname === "localhost")
            return "about:blank";
        if (hostname.match(/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/)) {
            const parts = hostname.split(".", 4); // direct ip access
            switch (parts[0]) {
                case "0": // 0.0.0.0/8
                case "127": // 127.0.0.0/8
                case "10": // 10.0.0.0/8
                    return "about:blank";
                default:
                    break;
            }
        }
        return url.href;
    }
    async newTab() {
        try {
            const page = await this.#context.newPage();
            await this.#updatePageSettings(page);
            this.#pages.push(page);
            this.socket.emit("tabopen", ++this.#focused);
            this.socket.emit("url", page.url());
        }
        catch (err) { }
    }
    async navigate(url) {
        try {
            await this.#focusedPage.goto(this.#checkRewriteURL(new URL(url)), {
                referer: "",
                timeout: 10000,
                waitUntil: "domcontentloaded"
            });
        }
        catch (err) { }
    }
    async goBack() {
        try {
            await this.#focusedPage.goBack({
                timeout: 10000,
                waitUntil: "domcontentloaded"
            });
        }
        catch (err) { }
    }
    async goForward() {
        try {
            await this.#focusedPage.goForward({
                timeout: 10000,
                waitUntil: "domcontentloaded"
            });
        }
        catch (err) { }
    }
    async refresh() {
        try {
            await this.#focusedPage.reload({
                timeout: 10000,
                waitUntil: "domcontentloaded"
            });
        }
        catch (err) { }
    }
    focusPage(id) {
        const page = this.#pages[id];
        if (page != null) {
            this.#focused = id;
            this.socket.emit("url", page.url());
        }
    }
    async closePage(id) {
        try {
            const page = this.#pages[id];
            if (page != null) {
                await page.close({ runBeforeUnload: false });
            }
        }
        catch (err) { }
    }
    async dispatchEvent(event) {
        try {
            switch (event.type) {
                case "mousedown":
                    await this.#focusedPage.mouse.down({ button: event.button });
                    break;
                case "mouseup":
                    await this.#focusedPage.mouse.up({ button: event.button });
                    break;
                case "mousemove":
                    await this.#focusedPage.mouse.move(event.x, event.y, { steps: 1 });
                    break;
                case "wheel":
                    await this.#focusedPage.mouse.wheel({ deltaX: event.deltaX, deltaY: event.deltaY });
                    break;
                case "touchstart":
                    await this.#focusedPage.touchscreen.touchStart(event.x, event.y);
                    break;
                case "touchend":
                    await this.#focusedPage.touchscreen.touchEnd();
                    break;
                case "touchmove":
                    await this.#focusedPage.touchscreen.touchMove(event.x, event.y);
                    break;
                case "keydown":
                    await this.#focusedPage.keyboard.down(event.key);
                    break;
                case "keyup":
                    await this.#focusedPage.keyboard.up(event.key);
                    break;
                default:
                    break;
            }
        }
        catch (err) { }
    }
    screenBuffer = () => this.#focusedPage.screenshot({
        type: "jpeg",
        quality: 80,
        encoding: "base64",
        fullPage: false,
        fromSurface: true,
        omitBackground: true,
        optimizeForSpeed: true,
        captureBeyondViewport: false
    });
    async end() {
        try {
            await this.#context.close();
        }
        catch (err) { }
        // free up memory
        this.#pages.length = 0;
        this.#context =
            this.socket =
                this.#pages =
                    this.#width =
                        this.#height =
                            this.#touch =
                                this.#landscape =
                                    this.#focused = void 0;
    }
    static {
        const proto = Session.prototype;
        Object.setPrototypeOf(proto, null);
        Object.freeze(proto);
    }
}
function initializeSession(session) {
    const { socket } = session;
    socket.on("navigate", (url) => session.navigate(url));
    socket.on("event", (e) => session.dispatchEvent(e));
    socket.on("newtab", () => session.newTab());
    socket.on("goback", () => session.goBack());
    socket.on("goforward", () => session.goForward());
    socket.on("refresh", () => session.refresh());
    socket.on("focustab", (i) => session.focusPage(i));
    socket.on("closetab", (i) => session.closePage(i));
    socket.on("disconnect", () => {
        socket.removeAllListeners();
        socket.disconnect(true);
        session.end();
        sessions.splice(sessions.indexOf(session), 1);
    });
    sessions.push(session);
}
async function loadFavicon(page) {
    try {
        const res = await fetch(await page.evaluate(`"use strict"; (() => {
	const elems = document.querySelectorAll("link");
	for (const elem of elems) {
		for (const it of (elem.getAttribute("rel") || "").trim().split(" ")) {
			if (it === "icon")
				return new URL(elem.getAttribute("href") || "/favicon.ico", document.baseURI).href;
		}
	}
	return new URL("/favicon.ico", document.baseURI).href;
})();`));
        if (!res.ok)
            return null;
        const type = (res.headers.get("content-type") || "").split(";", 2)[0].trim();
        if (!type.startsWith("image/"))
            return null;
        return "data:" + type + ";base64," + Buffer.from(await res.arrayBuffer()).toString("base64");
    }
    catch (err) {
        return null;
    }
}
io.on("connection", (socket) => {
    socket.on("request_new_session", async (opt) => {
        const w = opt.width;
        const h = opt.height;
        const t = opt.touch;
        const tor = opt.tor;
        if (typeof w !== "number" || typeof h !== "number" || typeof t !== "boolean" || typeof tor !== "boolean") {
            socket.disconnect(true);
            return;
        }
        const landscape = w > h;
        const width = Math.max(Math.min(w, landscape ? 1280 : 720), 300);
        const height = Math.max(Math.min(h, landscape ? 720 : 1280), 300);
        const context = await chrome.createIncognitoBrowserContext({
            proxyServer: tor ? "socks5://127.0.0.1:9050" : void 0,
            proxyBypassList: []
        });
        initializeSession(new Session(socket, context, width, height, t, landscape));
        socket.emit("session_ready", { width, height });
    });
});
const loop = async () => {
    for (const session of sessions) {
        try {
            session.socket.emit("frame", await session.screenBuffer());
        }
        catch (err) { }
    }
    setTimeout(loop, 50);
};
loop();
