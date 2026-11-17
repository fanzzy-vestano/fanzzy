import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/homepage-settings.ts", import.meta.url), "utf8");
function load(read) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => { assert.equal(name, "./supabase/catalog"); return { fetchStoreSettings: read }; } });
  return exports.fetchHomepageSettings;
}
test("hero slides and duration share a read but future updates read fresh settings", async () => {
  let calls = 0;
  const read = load(async keys => { assert.deepEqual(Array.from(keys), ["heroSlides", "heroImage", "heroSlideDuration"]); return { version: ++calls }; });
  const [slides, timing] = await Promise.all([read(), read()]);
  assert.equal(calls, 1);
  assert.equal(slides, timing);
  assert.equal((await read()).version, 2);
});
test("failed hero reads are not retained", async () => {
  let calls = 0;
  const read = load(async () => { if (++calls === 1) throw Error("offline"); return {}; });
  await assert.rejects(read(), /offline/);
  await read();
  assert.equal(calls, 2);
});
