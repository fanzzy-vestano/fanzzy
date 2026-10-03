export type ProductBarcodePrintInput = {
  productName: string;
  sku?: string;
  barcode: string;
  price?: string | number;
  copies?: number;
};

// Code 128 bar/space widths for values 0-106. Product barcodes use Code 128B
// so the browser can render a real, scanner-readable SVG without a font or a
// local printer helper.
const code128Patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const normalizedCopies = (copies: unknown) => Math.min(100, Math.max(1, Math.floor(Number(copies) || 1)));

const validateBarcode = (barcode: unknown) => {
  const value = String(barcode || "").trim();
  if (!value) throw new Error("This product does not have a barcode yet.");
  if (!/^\d{5}$/.test(value)) throw new Error("Barcode must be exactly five digits. Refresh the product catalog to update old barcodes.");
  return value;
};

const barcodeSvg = (value: string) => {
  const dataCodes = Array.from(value, (character) => character.charCodeAt(0) - 32);
  const checksum = (104 + dataCodes.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103;
  const codes = [104, ...dataCodes, checksum, 106];
  const quietZone = 10;
  let x = quietZone;
  const bars: string[] = [];

  for (const code of codes) {
    const pattern = code128Patterns[code];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="34" />`);
      x += width;
    }
  }

  const totalWidth = x + quietZone;
  return `<svg class="barcode-bars" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} 34" preserveAspectRatio="none" role="img" aria-label="Barcode ${escapeHtml(value)}"><g fill="#000">${bars.join("")}</g></svg>`;
};

const printablePrice = (value: string | number | undefined) => {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";
  const amount = Number(rawValue.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? `FRP :${amount.toFixed(2)}` : "";
};

const labelMarkup = (input: ProductBarcodePrintInput) => {
  const barcode = validateBarcode(input.barcode);
  const price = printablePrice(input.price);
  return `<section class="label">
    <div class="label-copy">
      <strong class="brand">fanZZy</strong>
      <span class="product-name">${escapeHtml(input.productName || "Fanzzy product")}</span>
      ${price ? `<span class="price">${escapeHtml(price)}</span>` : ""}
    </div>
    <div class="barcode-block">
      ${barcodeSvg(barcode)}
      <span class="barcode-number">${escapeHtml(barcode)}</span>
    </div>
  </section>`;
};

const printDocumentMarkup = (inputs: ProductBarcodePrintInput[]) => {
  const labels = inputs.flatMap((input) => Array.from({ length: normalizedCopies(input.copies) }, () => labelMarkup(input)));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fanzzy barcode labels</title>
<style>
  @page { size: 82mm 12mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .label {
    width: 82mm;
    height: 12mm;
    padding: 1mm 2.2mm;
    display: grid;
    grid-template-columns: minmax(0, 32mm) minmax(0, 1fr);
    align-items: center;
    column-gap: 2.2mm;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .label:last-child { break-after: auto; page-break-after: auto; }
  .label-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 1.05; }
  .brand { font-size: 8pt; letter-spacing: .2pt; }
  .product-name { margin-top: .35mm; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 6.5pt; }
  .price { margin-top: .45mm; font-size: 6.5pt; font-weight: 700; }
  .barcode-block { min-width: 0; display: flex; flex-direction: column; align-items: stretch; justify-content: center; }
  .barcode-bars { display: block; width: 100%; height: 6.1mm; shape-rendering: crispEdges; }
  .barcode-number { margin-top: .15mm; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 6.5pt; letter-spacing: 1.2pt; line-height: 1; }
  @media screen {
    body { padding: 14px; background: #d8d8d8; }
    .label { margin: 0 auto 14px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.2); }
  }
  @media print {
    html, body { width: 82mm; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>${labels.join("")}</body></html>`;
};

const printFromHiddenFrame = (markup: string) => {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "100%";
  frame.style.bottom = "0";
  frame.style.width = "82mm";
  frame.style.height = "12mm";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  if (!frameWindow) {
    frame.remove();
    throw new Error("Could not create the printer selection window.");
  }

  const cleanup = () => frame.remove();
  frameWindow.document.open();
  frameWindow.document.write(markup);
  frameWindow.document.close();
  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  frameWindow.focus();
  frameWindow.print();
  window.setTimeout(cleanup, 60_000);
};

const openBarcodePrintDialog = (inputs: ProductBarcodePrintInput[]) => {
  if (typeof window === "undefined") throw new Error("Barcode printing is only available in the browser.");

  const markup = printDocumentMarkup(inputs);

  // Keep window.open and print() in the original click call stack. Edge and
  // Chrome can suppress the dialog when either call happens after an await.
  const printWindow = window.open("", "_blank", "popup=yes,width=1000,height=760");
  if (!printWindow) {
    printFromHiddenFrame(markup);
    return;
  }

  try {
    printWindow.document.open();
    printWindow.document.write(markup);
    printWindow.document.close();
    printWindow.focus();
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
    printWindow.print();
  } catch {
    printWindow.close();
    printFromHiddenFrame(markup);
  }
};

// Kept for compatibility with older admin bundles. Browser printing does not
// need a local printer bridge or a prepared printer connection.
export async function prepareProductBarcodePrinter() {
  return true;
}

export async function printProductBarcode(input: ProductBarcodePrintInput) {
  const barcode = validateBarcode(input.barcode);
  const job = { ...input, barcode, copies: normalizedCopies(input.copies) };
  await openBarcodePrintDialog([job]);
  return { printed: true, printedProducts: 1, printedLabels: job.copies };
}

export async function printProductBarcodes(inputs: ProductBarcodePrintInput[]) {
  const jobs = inputs
    .filter((input) => String(input.barcode || "").trim())
    .map((input) => ({ ...input, barcode: validateBarcode(input.barcode), copies: normalizedCopies(input.copies) }));
  if (!jobs.length) throw new Error("Select at least one product with a barcode.");

  await openBarcodePrintDialog(jobs);
  return {
    printedProducts: jobs.length,
    printedLabels: jobs.reduce((sum, input) => sum + input.copies, 0),
  };
}
