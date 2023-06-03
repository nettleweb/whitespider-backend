import fs from "fs";
import fetch from "node-fetch";

const hosts = await (async () => {
	if (fs.existsSync("./local/hosts.txt")) {
		const mtime = fs.statSync("./local/hosts.txt", { bigint: true, throwIfNoEntry: true }).mtime;
		if (mtime.getTime() > Date.now() - 86400000) {
			return fs.readFileSync("./local/hosts.txt", "utf-8").split("\n");
		} else fs.unlinkSync("./local/hosts.txt");
	}

	const response = await fetch("https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts");
	if (!response.ok)
		throw new Error("Failed to update host file.");

	const list = ["localhost"];

	for (const line of (await response.text()).split("\n")) {
		if (line.startsWith("0.0.0.0 ")) {
			list.push(line.substring(8));
		}
	}

	fs.writeFileSync("./local/hosts.txt", list.join("\n"), "utf-8");
	return list;
})();

export default hosts;