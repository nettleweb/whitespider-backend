#!/bin/env node
import process from "process";

const { env, stdin, stdout, stderr } = process;
stdin.setEncoding("utf-8");
stdin.setDefaultEncoding("utf-8");
stdout.setEncoding("utf-8");
stdout.setDefaultEncoding("utf-8");
stderr.setEncoding("utf-8");
stderr.setDefaultEncoding("utf-8");

for (const k of Object.getOwnPropertyNames(Object.setPrototypeOf(env, null)))
	delete env[k];

env["HOME"] = "/tmp/__tmp_" + Date.now().toString(36);
env["PATH"] = "/sbin:/bin"
env["LANG"] = "C.UTF-8";
env["LC_ALL"] = "C.UTF-8";

process.chdir(import.meta.dirname);
process.on("unhandledRejection", () => {

});

await import("./out/main.js");
