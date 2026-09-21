// Refresh local, content-addressed display copies without changing uploaded originals.
// Run: node scripts/optimize-storefront-images.mjs --sharp-module <path-to-sharp>
// When sharp is installed in the project, the module argument can be omitted.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharpArgument = process.argv.indexOf("--sharp-module");
const sharp = require(sharpArgument >= 0 ? process.argv[sharpArgument + 1] : "sharp");
const root = new URL("../", import.meta.url);
const clientSource = await readFile(new URL("lib/supabase/client.ts", root), "utf8");
const origin = process.env.NEXT_PUBLIC_SUPABASE_URL || clientSource.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || clientSource.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
if (!origin || !key) throw new Error("Missing public catalog connection settings");
const readCatalog = async (path) => {
  const response = await fetch(`${origin}/rest/v1/${path}`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Catalog read failed: ${response.status}`);
  return response.json();
};
const [categories, settings] = await Promise.all([
  readCatalog("categories?select=image"),
  readCatalog("store_settings?select=key,value&key=in.(category_catalog,hero_slides,hero_image)"),
]);
const sources = new Map([["/fanzzy-mark.png", [192, 384]]]);
const add = (source, widths) => {
  if (typeof source === "string" && source.startsWith(`${origin}/storage/v1/object/public/fanzzy-assets/`)) {
    sources.set(source, widths);
  }
};
categories.forEach(({ image }) => add(image, [320, 640]));
for (const { key, value } of settings) {
  if (key === "hero_image") { add(value, [640, 1600]); continue; }
  const parsed = JSON.parse(value || "[]");
  if (!Array.isArray(parsed)) continue;
  parsed.forEach((row) => key === "category_catalog" ? add(row.image, [320, 640]) : add(row, [640, 1600]));
}
await mkdir(new URL("public/optimized/", root), { recursive: true });
await mkdir(new URL("lib/generated/", root), { recursive: true });
const manifest = {};
const report = [];
// Keep concurrency bounded so generating copies doesn't overload image storage.
for (const [source, widths] of sources) {
  let original;
  if (source.startsWith("/")) original = await readFile(new URL(`public${source}`, root));
  else {
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Image read failed: ${response.status} (${source})`);
    original = Buffer.from(await response.arrayBuffer());
  }
  const metadata = await sharp(original).metadata();
  if ((metadata.pages || 1) > 1) continue; // Preserve animated images.
  const copies = [];
  for (const width of widths) {
    const { data, info } = await sharp(original).rotate().resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 }).toBuffer({ resolveWithObject: true });
    const digest = createHash("sha256").update(data).digest("hex").slice(0, 20);
    const path = `/optimized/${digest}.webp`;
    await writeFile(new URL(`public${path}`, root), data);
    if (!copies.some((copy) => copy.width === info.width)) copies.push({ src: path, width: info.width, height: info.height });
    report.push({ source, width: info.width, originalBytes: original.length, optimizedBytes: data.length });
  }
  manifest[source] = copies;
}
await writeFile(new URL("lib/generated/storefront-images.json", root), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
