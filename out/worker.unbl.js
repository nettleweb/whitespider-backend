import worker from "worker_threads";
import puppeteer from "puppeteer";
const port = worker.parentPort;
if (worker.isMainThread)
    throw new Error("Invalid worker context");
const { dataDir, width, height, touch, landscape } = worker.workerData;
const pages = [];
let focused = -1;
const chrome = await puppeteer.launch({
    pipe: true,
    dumpio: true,
    timeout: 10000,
    product: "chrome",
    channel: "chrome",
    headless: true,
    userDataDir: dataDir,
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
        "--enable-gpu",
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
function updateURL() {
    const page = pages[focused];
    if (page != null) {
        port.postMessage(["url", page.url()]);
    }
}
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
async function loadFavicon(page) {
    try {
        const res = await fetch(await page.evaluate('"use strict"; (() => {\n\tfor (const e of document.querySelectorAll("link")) {\n\t\tfor (const it of (e.getAttribute("rel") || "").trim().split(" ")) {\n\t\t\tif (it === "icon") {\n\t\t\t\treturn new URL((e.getAttribute("href") || "").trim() || "/favicon.ico", document.baseURI).href;\n\t\t\t}\n\t\t}\n\t}\n\treturn new URL("/favicon.ico", document.baseURI).href;\n})();'), {
            method: "GET",
            signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
            const type = (res.headers.get("content-type") || "").split(";", 2)[0].trim();
            if (type.startsWith("image/")) {
                return "data:" + type + ";base64," + Buffer.from(await res.arrayBuffer()).toString("base64");
            }
        }
    }
    catch (err) {
    }
    return null;
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
        width: width,
        height: height,
        isMobile: false,
        hasTouch: touch,
        isLandscape: landscape,
        deviceScaleFactor: 1
    });
    page.setDefaultTimeout(2000);
    page.setDefaultNavigationTimeout(10000);
    page.on("load", async () => {
        const index = pages.indexOf(page);
        if (index >= 0) {
            port.postMessage(["tabinfo", {
                    id: index,
                    title: await page.title(),
                    favicon: await loadFavicon(page),
                }]);
            updateURL();
        }
    });
    page.on("close", () => {
        page.removeAllListeners();
        const index = pages.indexOf(page);
        if (index >= 0) {
            pages.splice(index, 1);
            if (focused >= pages.length)
                focused--;
            port.postMessage(["tabclose", index]);
            updateURL();
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
        default:
            break;
    }
});
port.postMessage(["session_ready", { width, height }]);
const loop = async () => {
    const page = pages[focused];
    if (page != null) {
        try {
            let buffer = "";
            const state = await page.evaluate("document.readyState");
            if (state !== "loading") {
                buffer = await page.screenshot({
                    type: "jpeg",
                    quality: 70,
                    encoding: "base64",
                    fullPage: false,
                    fromSurface: true,
                    omitBackground: true,
                    optimizeForSpeed: true,
                    captureBeyondViewport: false
                });
            }
            port.postMessage(["frame", buffer]);
        }
        catch (err) { }
    }
    setTimeout(loop, 100);
};
await loop();
