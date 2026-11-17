import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const vinextEntry = fileURLToPath(await import.meta.resolve("vinext"));
const vinextCli = resolve(dirname(vinextEntry), "cli.js");
const child = spawn(process.execPath, [vinextCli, ...process.argv.slice(2)], { stdio: "inherit" });

child.on("error", (error) => {
  console.error(`Unable to start vinext: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = typeof code === "number" ? code : 1;
  if (signal) console.error(`vinext exited with signal ${signal}`);
});
