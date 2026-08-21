import { spawn } from "node:child_process";
import { resolve } from "node:path";

const node = process.execPath;
const bridge = spawn(node, [resolve("scripts/printer-bridge.mjs")], { stdio: "inherit", windowsHide: true });
const app = spawn(node, [resolve("node_modules/vinext/dist/cli.js"), "dev", ...process.argv.slice(2)], { stdio: "inherit" });

const stop = () => {
  if (!bridge.killed) bridge.kill();
  if (!app.killed) app.kill();
};
process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(143); });
app.once("exit", (code) => { if (!bridge.killed) bridge.kill(); process.exit(code ?? 0); });
