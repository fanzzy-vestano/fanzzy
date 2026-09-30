export type ProductBarcodePrintInput = {
  productName: string;
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
