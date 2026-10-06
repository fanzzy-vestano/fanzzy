import assert from "node:assert/strict";
import test from "node:test";

import { printProductBarcode } from "../lib/barcode-printer.ts";

test("browser label matches the supplied 79.5 mm PRN layout", async () => {
  let markup = "";
  let printCalled = false;
  const originalWindow = globalThis.window;

  globalThis.window = {
    open: () => ({
      document: {
        open() {},
        write(value) { markup = value; },
        close() {},
      },
      focus() {},
      addEventListener() {},
      print() { printCalled = true; },
      close() {},
    }),
  };

  try {
    await printProductBarcode({
      productName: "Love rose gold ring",
      barcode: "12345",
      price: 59,
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }

  assert.equal(printCalled, true);
  assert.match(markup, /@page \{ size: 79\.5mm 12mm; margin: 0; \}/);
  assert.match(markup, /\.brand \{ left: 2\.125mm; top: \.625mm;/);
  assert.match(markup, /\.product-name \{ left: 2\.125mm; top: 4mm; width: 22mm;/);
  assert.match(markup, /\.price \{ left: 6\.125mm; top: 8\.125mm;/);
  assert.match(markup, /\.barcode-block \{ left: 24\.25mm; top: 1\.25mm; width: 24\.25mm;/);
  assert.match(markup, /\.barcode-bars \{[^}]*height: 4\.625mm;/);
  assert.match(markup, /viewBox="0 0 99 34"/);
  assert.match(markup, /FRP: 59\.00/);
  assert.match(markup, /aria-label="Barcode 12345"/);
});
