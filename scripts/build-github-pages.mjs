import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const run = (entry, args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env: { ...process.env, GITHUB_PAGES: "true" },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${entry} exited with code ${code}`)));
});

await rm(join(root, "dist"), { recursive: true, force: true });
await run(join(root, "node_modules", "vinext", "dist", "cli.js"), ["build"]);
await run(join(root, "scripts", "ensure-build-assets.mjs"));

const source = join(root, "dist", "client");
const staging = join(root, "work", "docs-next");
const published = join(root, "docs");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(source, staging, { recursive: true });
await writeFile(join(staging, "CNAME"), "fanzzy.in\n", "utf8");
await writeFile(join(staging, ".nojekyll"), "GitHub Pages static site.\n", "utf8");

// Confirm the staged export is complete before replacing the published tree.
await readFile(join(staging, "index.html"), "utf8");
await readFile(join(staging, "admin", "index.html"), "utf8");
await readFile(join(staging, "404.html"), "utf8");
await rm(published, { recursive: true, force: true });
await rename(staging, published);
console.log("GitHub Pages export prepared in docs/.");
