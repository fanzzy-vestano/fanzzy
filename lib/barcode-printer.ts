export type ProductBarcodePrintInput = {
  productName: string;
  sku?: string;
  barcode: string;
  price?: string | number;
  copies?: number;
};

const defaultPrinterName = "Essae PR-55";

const selectedPrinterName = (printerName?: string) => (printerName || window.localStorage.getItem("fanzzy-printer-name") || defaultPrinterName)
  .replace("Essae PR 55", defaultPrinterName);

export async function prepareProductBarcodePrinter(printerName?: string) {
  if (typeof window === "undefined") return false;
  const response = await fetch("http://127.0.0.1:3002/prepare-printer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printerName: selectedPrinterName(printerName) }),
  });
  return response.ok;
}

export async function printProductBarcode(input: ProductBarcodePrintInput) {
  if (typeof window === "undefined") throw new Error("Barcode printing is only available in the browser.");
  const barcode = String(input.barcode || "").trim();
  if (!barcode) throw new Error("This product does not have a barcode yet.");
  const savedPrinter = selectedPrinterName();
  const response = await fetch("http://127.0.0.1:3002/print-barcode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productName: input.productName,
      sku: input.sku,
      barcode,
      price: input.price,
      copies: Math.min(100, Math.max(1, Math.floor(Number(input.copies) || 1))),
      printerName: savedPrinter,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; printed?: boolean };
  if (!response.ok || !payload.printed) throw new Error(payload.error || "Could not print the barcode label.");
  return payload;
}

export async function printProductBarcodes(inputs: ProductBarcodePrintInput[]) {
  const jobs = inputs.filter((input) => String(input.barcode || "").trim()).map((input) => ({
    ...input,
    copies: Math.min(100, Math.max(1, Math.floor(Number(input.copies) || 1))),
  }));
  if (!jobs.length) throw new Error("Select at least one product with a barcode.");

  const savedPrinter = selectedPrinterName();
  const batchResponse = await fetch("http://127.0.0.1:3002/print-barcodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: jobs, printerName: savedPrinter }),
  });
  if (batchResponse.status !== 404) {
    const payload = await batchResponse.json().catch(() => ({})) as { error?: string; printed?: boolean; printedProducts?: number; printedLabels?: number };
    if (!batchResponse.ok || !payload.printed) throw new Error(payload.error || "Could not print the selected barcode labels.");
    return {
      printedProducts: payload.printedProducts || jobs.length,
      printedLabels: payload.printedLabels || jobs.reduce((sum, input) => sum + Number(input.copies || 1), 0),
    };
  }

  // Compatibility fallback for a printer bridge that has not restarted yet.
  let printedProducts = 0;
  let printedLabels = 0;
  for (const input of jobs) {
    const copies = Number(input.copies || 1);
    try {
      // Send one label per queued request so multi-copy batches also work
      // with an already-running printer bridge that predates copy support.
      for (let copy = 0; copy < copies; copy += 1) {
        await printProductBarcode({ ...input, copies: 1 });
        printedLabels += 1;
      }
      printedProducts += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not print the barcode label.";
      throw new Error(`${printedLabels} label${printedLabels === 1 ? "" : "s"} printed before ${input.productName} failed: ${message}`);
    }
  }

  return { printedProducts, printedLabels };
}
