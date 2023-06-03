import fs from "fs";
import os from "os";
import dns from "dns";
import puppeteer from "puppeteer";

dns.setDefaultResultOrder("ipv4first");
dns.setServers(["1.1.1.1", "1.0.0.1"]);
dns.promises.setDefaultResultOrder("ipv4first");
dns.promises.setServers(["1.1.1.1", "1.0.0.1"]);
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

function getExecutable() {
	const path = os.platform() === "win32" ? ".\\local\\chrome\\chrome.exe" : "./local/chrome/chrome";
	return fs.existsSync(path) ? path: puppeteer.executablePath("chrome");
}

const chrome = await puppeteer.launch({
	headless: true,
	defaultViewport: {
		width: 1280,
		height: 720,
		hasTouch: false,
		isLandscape: true,
		isMobile: false,
		deviceScaleFactor: 1
	},
	args: [
		"--no-sandbox",
		"--disable-setuid-sandbox",
		"--disable-web-security",
		"--disable-dev-shm-usage",
		"--disable-infobars",
		"--disable-gpu",
		"--window-size=1280,720",
		"--window-position=0,0"
	],
	userDataDir: "./local/data/",
	executablePath: getExecutable(),
	pipe: true,
	product: "chrome",
	dumpio: true,
	timeout: 10000
});

export default chrome;