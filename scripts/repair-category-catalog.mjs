import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mergeCatalogCategories, createProductCategoryResolver } from "../lib/catalog-categories.ts";

// The checked-in browser configuration contains only public connection values.
const clientSource = await readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || clientSource.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || clientSource.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
if (!url || !key) throw new Error("Missing Supabase connection settings");
const endpoint = `${url}/rest/v1/store_settings`;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const readSnapshot = async () => {
  const response = await fetch(`${endpoint}?key=eq.category_catalog&select=key,value,updated_at`, { headers });
  if (!response.ok) throw new Error(`Category read failed: ${response.status}`);
  const rows = await response.json();
  if (rows.length !== 1 || typeof rows[0].value !== "string") throw new Error("Expected exactly one category snapshot");
  return rows[0];
};
const snapshot = await readSnapshot();
const original = JSON.parse(snapshot.value);
if (!Array.isArray(original) || original.some(row => !row || typeof row.name !== "string" || !row.name.trim())) {
  throw new Error("Unexpected category records; manual review required");
}
const start = performance.now();
const cleaned = mergeCatalogCategories(original);
const resolver = createProductCategoryResolver(cleaned);
const options = [...new Set(original.map(row => resolver(row.name)))];
const processingMs = Math.round((performance.now() - start) * 100) / 100;
const value = JSON.stringify(cleaned);
const identities = rows => new Set(rows.map(row => `${row.name.trim().toLowerCase()}::${row.section || "normal"}`));
if (identities(original).size !== identities(cleaned).size) throw new Error("Repair would lose category identities");
const report = {
  origin: url, before: original.length, after: cleaned.length,
  duplicateCopies: original.length - cleaned.length,
  bytesBefore: Buffer.byteLength(snapshot.value), bytesAfter: Buffer.byteLength(value),
  processingMs, categoryOptions: options.length,
  categories: cleaned.map(({ name, section, image, pieces }) => ({ name, section, pieces, hasImage: Boolean(image) })),
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--apply")) {
  if (value === snapshot.value) { console.log("Already clean; no update needed."); process.exit(0); }
  if (!snapshot.updated_at) throw new Error("Missing revision; refusing to overwrite an unversioned snapshot");
  const backupDirectory = resolve("work", "category-repair", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(resolve(backupDirectory, "category_catalog.json"), JSON.stringify(snapshot, null, 2), { flag: "wx" });
  await writeFile(resolve(backupDirectory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  // Compare the revision so another admin's edit is never silently overwritten.
  const response = await fetch(`${endpoint}?key=eq.category_catalog&updated_at=eq.${encodeURIComponent(snapshot.updated_at)}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ value, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Category repair failed: ${response.status}; backup: ${backupDirectory}`);
  const changed = await response.json();
  if (changed.length !== 1) throw new Error("Snapshot changed during repair; no update applied. Run again.");
  const verified = await readSnapshot();
  if (verified.value !== value) throw new Error("Shared snapshot changed after repair; inspect before retrying");
  console.log(JSON.stringify({ repaired: true, verifiedRecords: cleaned.length, backupDirectory }));
} else {
  console.log("Read-only check; use --apply after deploying the category fix.");
}
