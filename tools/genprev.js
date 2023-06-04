#!/bin/env node
// Game preview generator
import fs from "fs";
import hosts from "../hosts.js";
import chrome from "../chrome.js";

for (const line of fs.readFileSync("./static/games/list.txt", "utf-8").split("\n")) {
	const [ name, type, url ] = line.split(";", 3);
	const path = "./static/games/previews/" + name + ".jpg";
	if (fs.existsSync(path)) {
		continue;
	}

	const context = await chrome.createIncognitoBrowserContext({});
	const page = await context.newPage();
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
		width: 800,
		height: 600,
		hasTouch: false,
		isLandscape: true,
		isMobile: false,
		deviceScaleFactor: 1
	});

	page.on("popup", (page) => page.close({ runBeforeUnload: false }));
	page.on("request", (request) => {
		const url = new URL(request.url());
		switch (url.protocol) {
			case "http:":
			case "https:":
				const host = url.hostname;
				if (hosts.includes(host)) {
					request.abort("blockedbyclient");
					return;
				}
				request.continue();
				break;
			case "data:":
			case "blob:":
				request.continue();
				break;
			default:
				request.abort("accessdenied");
				break;
		}
	});

	await page.goto("https://whitespider.gq/player.html?type=" + type + "&url=" + encodeURIComponent(url), {
		referer: "",
		timeout: 10000,
		waitUntil: "domcontentloaded"
	});
	await new Promise(resolve => setTimeout(resolve, 15000));
	await page.screenshot({
		path: path,
		type: "jpeg",
		quality: 70,
		encoding: "binary",
		fullPage: false,
		fromSurface: true,
		omitBackground: true
	});
	await page.close({ runBeforeUnload: false });
	await context.close();
}

await chrome.close();
