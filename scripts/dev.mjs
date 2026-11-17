import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionProjectRef = "pdrcrkxeyqxqgpwfxqpu";
const envText = existsSync(resolve(".env.local")) ? readFileSync(resolve(".env.local"), "utf8") : "";
if (envText.includes(productionProjectRef) || /RAZORPAY_KEY_ID\s*=\s*rzp_live_/i.test(envText)) {
  console.error("Local development startup blocked because .env.local contains production services. Use npm run dev:test with a separate .env.local.test.");
  process.exit(1);
}

const node = process.execPath;
const app = spawn(node, [resolve("node_modules/vinext/dist/cli.js"), "dev", ...process.argv.slice(2)], { stdio: "inherit" });

const stop = () => {
  if (!app.killed) app.kill();
};
process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(143); });
app.once("exit", (code) => { process.exit(code ?? 0); });
