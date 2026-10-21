import { readFileSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
export function compileBrowserModule(file) {
  return ts.transpileModule(readFileSync(new URL(file, root), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const storageCode = compileBrowserModule("lib/browser-storage.ts");
export function loadBrowserStorage(window) {
  const exports = {};
  new Function("exports", "window", storageCode)(exports, window);
  return exports;
}

export function loadBrowserModule(file, window, imports = {}, storage = loadBrowserStorage(window), extras = {}) {
  const exports = {};
  const names = ["exports", "window", "require", ...Object.keys(extras)];
  new Function(...names, compileBrowserModule(file))(exports, window, name => {
    if (name === "./browser-storage") return storage;
    if (name in imports) return imports[name];
    throw Error("Unmocked import: " + name);
  }, ...Object.values(extras));
  return exports;
}
