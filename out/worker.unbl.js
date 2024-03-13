import worker from "worker_threads";
import process from "process";
import puppeteer from "puppeteer";
import stubImage from "./stubImage.js";
const port = worker.parentPort;
if (worker.isMainThread)
    throw new Error("Invalid worker context");
const data = Object.freeze(Object.setPrototypeOf(worker.workerData, null));
const pages = [];
let focused = -1;
const chrome = await puppeteer.launch({
    pipe: true,
    dumpio: true,
    channel: "chrome",
    product: "chrome",
    timeout: 10000,
    headless: true,
    userDataDir: data.dataDir,
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    executablePath: "./local/chrome/chrome",
    protocolTimeout: 5000,
    defaultViewport: {
        width: 1280,
        height: 720,
        isMobile: false,
        hasTouch: false,
        isLandscape: true,
        deviceScaleFactor: 1
    },
    args: [
        "--use-angle=vulkan",
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--no-sandbox",
        "--disable-sync",
        "--disable-logging",
        "--disable-breakpad",
        "--disable-infobars",
        "--disable-translate",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-notifications",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--window-name=\"\ud800\"",
        "--window-size=1280,720",
        "--window-position=0,0"
    ],
    ignoreDefaultArgs: [
        "--hide-scrollbars"
    ]
});
function checkRewriteURL(url) {
    switch (url.protocol) {
        case "http:":
        case "https:":
            break;
        case "data:":
            return url.href;
        default:
            return "about:blank";
    }
    const host = url.hostname;
    if (host === "localhost")
        return "about:blank";
    if (host.match(/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/)) {
        const parts = host.split(".", 4); // direct ip access
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
async function updatePageSettings(page) {
    await page.setBypassCSP(true);
    await page.setCacheEnabled(true);
    await page.setJavaScriptEnabled(true);
    await page.setGeolocation({
        latitude: 0,
        longitude: 0,
        accuracy: 0
    });
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0", {
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
        width: data.width,
        height: data.height,
        isMobile: false,
        hasTouch: data.touch,
        isLandscape: data.landscape,
        deviceScaleFactor: 1
    });
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    page.on("load", async () => {
        const index = pages.indexOf(page);
        if (index >= 0) {
            let title, favicon;
            try {
                title = await page.title();
            }
            catch (err) { }
            try {
                const res = await fetch(await page.evaluate('"use strict"; (() => {\n\tfor (const e of document.querySelectorAll("link")) {\n\t\tfor (const it of (e.getAttribute("rel") || "").trim().split(" ")) {\n\t\t\tif (it === "icon") {\n\t\t\t\treturn new URL((e.getAttribute("href") || "").trim() || "/favicon.ico", document.baseURI).href;\n\t\t\t}\n\t\t}\n\t}\n\treturn new URL("/favicon.ico", document.baseURI).href;\n})();'), {
                    method: "GET",
                    signal: AbortSignal.timeout(5000)
                });
                if (res.ok) {
                    const type = (res.headers.get("content-type") || "").split(";", 2)[0].trim();
                    if (type.startsWith("image/")) {
                        favicon = "data:" + type + ";base64," + Buffer.from(await res.arrayBuffer()).toString("base64");
                    }
                }
            }
            catch (err) { }
            port.postMessage(["tabinfo", {
                    id: index,
                    title: title || "",
                    favicon: favicon,
                }]);
            port.postMessage(["url", page.url()]);
        }
    });
    page.on("close", () => {
        page.removeAllListeners();
        const index = pages.indexOf(page);
        if (index >= 0) {
            pages.splice(index, 1);
            port.postMessage(["tabclose", index]);
            if (focused >= pages.length) {
                const page = pages[--focused];
                if (page != null)
                    port.postMessage(["url", page.url()]);
            }
        }
    });
    page.on("popup", (page) => {
        if (page != null) {
            updatePageSettings(page).catch(() => void 0);
            port.postMessage(["tabopen", ++focused]);
            port.postMessage(["url", page.url()]);
            pages.push(page);
        }
    });
}
async function newTab() {
    try {
        const page = await chrome.newPage();
        await updatePageSettings(page);
        port.postMessage(["tabopen", ++focused]);
        port.postMessage(["url", page.url()]);
        pages.push(page);
    }
    catch (err) { }
}
async function navigate(url) {
    const page = pages[focused];
    if (page != null) {
        try {
            await page.goto(checkRewriteURL(new URL(url)), {
                referer: "",
                timeout: 10000,
                waitUntil: "load"
            });
        }
        catch (err) { }
    }
}
async function goBack() {
    const page = pages[focused];
    if (page != null) {
        try {
            await page.goBack({
                timeout: 10000,
                waitUntil: "load"
            });
        }
        catch (err) { }
    }
}
async function goForward() {
    const page = pages[focused];
    if (page != null) {
        try {
            await page.goForward({
                timeout: 10000,
                waitUntil: "load"
            });
        }
        catch (err) { }
    }
}
async function refresh() {
    const page = pages[focused];
    if (page != null) {
        try {
            await page.reload({
                timeout: 10000,
                waitUntil: "load"
            });
        }
        catch (err) { }
    }
}
function focusPage(id) {
    const page = pages[id];
    if (page != null) {
        focused = id;
        port.postMessage(["url", page.url()]);
    }
}
async function closePage(id) {
    const page = pages[id];
    if (page != null) {
        try {
            await page.close({ runBeforeUnload: false });
        }
        catch (err) { }
    }
}
async function dispatchEvent(event) {
    const page = pages[focused];
    if (page != null) {
        try {
            switch (event.type) {
                case "mousedown":
                    await page.mouse.down({ button: event.button });
                    break;
                case "mouseup":
                    await page.mouse.up({ button: event.button });
                    break;
                case "mousemove":
                    await page.mouse.move(event.x, event.y, { steps: 1 });
                    break;
                case "wheel":
                    await page.mouse.wheel({ deltaX: event.deltaX, deltaY: event.deltaY });
                    break;
                case "touchstart":
                    await page.touchscreen.touchStart(event.x, event.y);
                    break;
                case "touchend":
                    await page.touchscreen.touchEnd();
                    break;
                case "touchmove":
                    await page.touchscreen.touchMove(event.x, event.y);
                    break;
                case "keydown":
                    await page.keyboard.down(event.key);
                    break;
                case "keyup":
                    await page.keyboard.up(event.key);
                    break;
                default:
                    break;
            }
        }
        catch (err) { }
    }
}
async function exitListener() {
    await chrome.close();
    process.exit(0);
}
process.on("SIGHUP", exitListener);
process.on("SIGINT", exitListener);
process.on("SIGTERM", exitListener);
process.on("SIGQUIT", exitListener);
port.on("message", (args) => {
    switch (args.shift()) {
        case "newtab":
            newTab();
            break;
        case "navigate":
            navigate(args.shift());
            break;
        case "goback":
            goBack();
            break;
        case "goforward":
            goForward();
            break;
        case "refresh":
            refresh();
            break;
        case "focustab":
            focusPage(args.shift());
            break;
        case "closetab":
            closePage(args.shift());
            break;
        case "event":
            dispatchEvent(args.shift());
            break;
        case "stop":
            exitListener();
            break;
        default:
            break;
    }
});
const loop = async () => {
    const page = pages[focused];
    if (page != null) {
        let buffer;
        try {
            if (await page.evaluate("document.readyState") !== "loading") {
                buffer = (await page.screenshot({
                    type: "jpeg",
                    quality: 50,
                    encoding: "binary",
                    fullPage: false,
                    fromSurface: false,
                    omitBackground: true,
                    optimizeForSpeed: true,
                    captureBeyondViewport: false
                })).buffer;
            }
        }
        catch (err) { }
        port.postMessage(["frame", buffer || stubImage]);
    }
    setTimeout(loop, 100);
};
port.postMessage(["session_ready", {
        width: data.width,
        height: data.height
    }]);
await loop();
