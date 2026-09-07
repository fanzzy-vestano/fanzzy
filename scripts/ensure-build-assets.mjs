import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const projectRoot = process.cwd();
const manifestPath = join(projectRoot, "dist", "server", "__vite_rsc_assets_manifest.js");
const clientRoot = join(projectRoot, "dist", "client");
const manifest = await readFile(manifestPath, "utf8");
const assetPaths = new Set(Array.from(manifest.matchAll(/["'](\/assets\/[^"']+\.js)["']/g), (match) => match[1]));

for (const assetPath of assetPaths) {
  const outputPath = join(clientRoot, assetPath.replace(/^\//, ""));
  try {
    await access(outputPath);
  } catch {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "// Empty style companion required by the generated RSC asset manifest.\n", "utf8");
  }
}
