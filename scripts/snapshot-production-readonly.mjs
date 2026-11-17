// Creates a local-only snapshot for previewing the real Fanzzy data.
// This script is deliberately GET-only: it never sends a production write.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const productionHost = "pdrcrkxeyqxqgpwfxqpu.supabase.co";
const pageSize = 1000;

const readEnv = (file) => {
  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
};

const readAll = async (baseUrl, serviceKey, table, select) => {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`/rest/v1/${table}`, baseUrl);
    url.searchParams.set("select", select);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) throw new Error(`Production snapshot read for ${table} failed (${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Production snapshot read for ${table} returned an unexpected result.`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
};

const readAllWithFallback = async (baseUrl, serviceKey, table, selects) => {
  let lastError;
  for (const select of selects) {
    try { return await readAll(baseUrl, serviceKey, table, select); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error(`Production snapshot read for ${table} failed.`);
};

const readOptional = async (baseUrl, serviceKey, table, selects) => {
  try { return await readAllWithFallback(baseUrl, serviceKey, table, selects); }
  catch { return []; }
};

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const envFile = join(root, ".env.local");
  if (!existsSync(envFile)) throw new Error(".env.local is required to make the local real-data preview snapshot.");
  const env = readEnv(envFile);
  const baseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  let parsedUrl;
  try { parsedUrl = new URL(baseUrl); } catch { throw new Error("The production Supabase URL is not configured."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== productionHost) throw new Error("Refusing to read from an unexpected Supabase project.");
  if (!serviceKey) throw new Error("The production service role key is not configured.");

  const [products, categories, settings, vendors] = await Promise.all([
    readAllWithFallback(baseUrl, serviceKey, "products", ["sku,name,category,stock,price,cost,status,image,hover_image,compare_at,tag,tone,created_at,updated_at,vendor_id,vendor_status,public_vendor_visible", "sku,name,category,stock,price,cost,status,image,hover_image,compare_at,tag,tone,created_at,updated_at"]),
    readAllWithFallback(baseUrl, serviceKey, "categories", ["name,pieces,image,sort_order,section,created_at", "name,pieces,image,sort_order,created_at"]),
    readAllWithFallback(baseUrl, serviceKey, "store_settings", ["key,value,updated_at", "key,value"]),
    readOptional(baseUrl, serviceKey, "vendors", ["id,slug,business_name,logo_url,cover_url,description,featured,status,store_visibility"]),
  ]);

  const directory = join(root, ".local-real-preview");
  mkdirSync(directory, { recursive: true });
  const snapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    source: "production-read-only",
    products,
    categories,
    settings,
    vendors,
  };
  const destination = join(directory, "snapshot.json");
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, destination);
  console.log(`Read-only local snapshot created: ${products.length} products, ${categories.length} categories, ${settings.length} settings, ${vendors.length} vendors.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not create the local real-data snapshot.");
  process.exitCode = 1;
});
