import assert from "node:assert/strict";
import test from "node:test";
import { prepareStoreImage } from "../lib/store-image-upload.ts";

test("product photos and animated formats are kept intact", async () => {
  const product = new File(["original"], "product.png", { type: "image/png" });
  const animated = new File(["animation"], "banner.gif", { type: "image/gif" });
  assert.equal(await prepareStoreImage(product, "products"), product);
  assert.equal(await prepareStoreImage(animated, "homepage"), animated);
});

test("new banners/categories are resized and encoded with a fallback on errors", async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalDecoder = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  t.after(() => {
    for (const [name, descriptor] of [["document", originalDocument], ["createImageBitmap", originalDecoder]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const canvases = [];
  let closed = 0;
  let fail = false;
  let outputSize = 100;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 2000, close() { closed++; } });
  globalThis.document = { createElement() {
    const canvas = {
      width: 0, height: 0,
      getContext() { if (fail) throw new Error("Decode failed"); return { drawImage() {} }; },
      toBlob(callback, type) { callback(new Blob([new Uint8Array(outputSize)], { type })); },
    };
    canvases.push(canvas);
    return canvas;
  } };
  const original = new File([new Uint8Array(1000)], "banner.png", { type: "image/png" });
  const banner = await prepareStoreImage(original, "homepage");
  assert.equal(banner.type, "image/webp");
  assert.equal(banner.name, "banner.webp");
  assert.equal(banner.size, 100);
  assert.deepEqual([canvases[0].width, canvases[0].height], [1920, 960]);
  await prepareStoreImage(original, "categories");
  assert.deepEqual([canvases[1].width, canvases[1].height], [960, 480]);
  outputSize = 2000;
  assert.equal(await prepareStoreImage(original, "categories"), original);
  fail = true;
  assert.equal(await prepareStoreImage(original, "homepage"), original);
  assert.equal(closed, 4);
});
