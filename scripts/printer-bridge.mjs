import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.FANZZY_PRINTER_PORT || 3002);
const defaultPrinter = "Essae PR-55";
const logoCacheDirectory = join(tmpdir(), "fanzzy-logo-cache");
const printerWorkerScript = join(process.cwd(), "scripts", "printer-worker.ps1");
const qrImagePath = join(process.cwd(), "public", "vestano-retail-qr-code.png");
const thermalLogoImagePath = join(process.cwd(), "public", "fanzzy-mark-thermal.png");
const qrMarker = "<<FANZZY_QR>>";
const barcodePrintPreviews = new Map();
let printerWorker = null;
let printerWorkerReady = null;
let printerWorkerName = "";
let printerWorkerQrPath = "";
const printerWorkerRequests = [];
const defaultBillDesign = {
  showLogo: true,
  logoAsset: "fanzzy-mark.png",
  logoText: "fanZZy",
  tagline: "JEWELLERY WITH INTENTION",
  separator: "dotted",
  showQrCode: true,
  qrCodeAsset: "vestano-retail-qr-code.png",
  showStatus: true,
  showPhone: true,
  showAddress: true,
  thankYouText: "Thank you for shopping with Fanzzy.",
};

const text = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
const money = (value) => text(value).replace(/^₹/, "Rs.");
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

// Code 128 bar/space widths for values 0-106. Barcode previews use Code 128B
// so the browser prints a real, scanner-readable barcode without a font.
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
];

const browserBarcodeSvg = (value) => {
  const dataCodes = Array.from(value, (character) => character.charCodeAt(0) - 32);
  const checksum = (104 + dataCodes.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103;
  const codes = [104, ...dataCodes, checksum, 106];
  const quietZone = 10;
  let x = quietZone;
  const bars = [];
  for (const code of codes) {
    const pattern = code128Patterns[code];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="34" />`);
      x += width;
    }
  }
  return `<svg class="barcode-bars" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + quietZone} 34" preserveAspectRatio="none" role="img" aria-label="Barcode ${escapeHtml(value)}"><g fill="#000">${bars.join("")}</g></svg>`;
};

const browserLabelPrice = (value) => {
  const raw = text(value);
  if (!raw) return "";
  const amount = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? `FRP :${amount.toFixed(2)}` : "";
};

const browserLabelMarkup = (item) => {
  const barcode = text(item.barcode);
  const price = browserLabelPrice(item.price);
  return `<section class="label">
    <div class="label-copy">
      <strong class="brand">fanZZy</strong>
      <span class="product-name">${escapeHtml(text(item.productName) || "Fanzzy product")}</span>
      ${price ? `<span class="price">${escapeHtml(price)}</span>` : ""}
    </div>
    <div class="barcode-block">
      ${browserBarcodeSvg(barcode)}
      <span class="barcode-number">${escapeHtml(barcode)}</span>
    </div>
  </section>`;
};

const browserPrintDocument = (items) => {
  const labels = items.flatMap((item) => Array.from({ length: Math.min(100, Math.max(1, Math.floor(Number(item.copies) || 1))) }, () => browserLabelMarkup(item)));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fanzzy barcode labels</title>
<style>
  @page { size: 82mm 12mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .label { width: 82mm; height: 12mm; padding: 1mm 2.2mm; display: grid; grid-template-columns: minmax(0, 32mm) minmax(0, 1fr); align-items: center; column-gap: 2.2mm; overflow: hidden; break-after: page; page-break-after: always; }
  .label:last-child { break-after: auto; page-break-after: auto; }
  .label-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 1.05; }
  .brand { font-size: 8pt; letter-spacing: .2pt; }
  .product-name { margin-top: .35mm; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 6.5pt; }
  .price { margin-top: .45mm; font-size: 6.5pt; font-weight: 700; }
  .barcode-block { min-width: 0; display: flex; flex-direction: column; align-items: stretch; justify-content: center; }
  .barcode-bars { display: block; width: 100%; height: 6.1mm; shape-rendering: crispEdges; }
  .barcode-number { margin-top: .15mm; text-align: center; font-size: 6.5pt; letter-spacing: 1.2pt; line-height: 1; }
  @media screen { body { visibility: hidden; } }
  @media print { html, body { width: 82mm; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${labels.join("")}<script>
  addEventListener("afterprint", () => close(), { once: true });
  focus();
  print();
</script></body></html>`;
};

const openBrowserBarcodePrint = (items) => {
  const previewId = randomUUID();
  barcodePrintPreviews.set(previewId, { markup: browserPrintDocument(items), expiresAt: Date.now() + 5 * 60_000 });
  for (const [id, preview] of barcodePrintPreviews) {
    if (preview.expiresAt < Date.now()) barcodePrintPreviews.delete(id);
  }
  const previewUrl = `http://127.0.0.1:${port}/print-preview/${previewId}`;
  const browserCandidates = [
    join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  const browserExecutable = browserCandidates.find((candidate) => candidate && existsSync(candidate));
  const child = browserExecutable
    ? spawn(browserExecutable, [`--app=${previewUrl}`, "--no-first-run"], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    })
    : spawn("explorer.exe", [previewUrl], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};
const parseMoney = (value) => {
  let normalized = text(value).replace(/[^\d,.-]/g, "");
  if (!normalized) return Number.NaN;
  const lastDot = normalized.lastIndexOf(".");
  const lastComma = normalized.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    normalized = normalized.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    const fractionDigits = normalized.length - lastComma - 1;
    normalized = fractionDigits <= 2
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const makeReceipt = (order, configuredDesign = {}) => {
  const design = { ...defaultBillDesign, ...configuredDesign };
  const currency = (value) => {
    const parsed = parseMoney(value);
    if (!Number.isFinite(parsed)) return money(value).replace(/^[^0-9-]+/, "Rs.");
    const rounded = Math.round(parsed * 100) / 100;
    return `Rs.${rounded.toLocaleString("en-IN", {
      minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  };
  const fit = (value, width) => text(value).slice(0, width);
  const wrap = (value, width) => {
    const clean = text(value);
    if (!clean) return [""];
    const words = clean.split(/\s+/);
    const result = [];
    let line = "";
    for (const word of words) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else { result.push(line); line = word; }
    }
    if (line) result.push(line);
    return result.length ? result : [clean.slice(0, width)];
  };
  const right = (value, width) => text(value).slice(-width).padStart(width, " ");
  const dateLabel = (value) => {
    const date = new Date(`${text(value)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  };
  const esc = "\x1b";
  const reset = `${esc}@`;
  const left = `${esc}a\x00`;
  const center = `${esc}a\x01`;
  const bold = `${esc}E\x01`;
  const logoLarge = `${esc}E\x01\x1d!\x22`;
  const normal = `${esc}E\x00${esc}!\x00\x1d!\x00`;
  const separator = design.separator === "dashed" ? "------------------------------------------------" : "................................................";
  const solid = "________________________________________________";
  const topRow = (leftText, rightText) => `${fit(leftText, 27).padEnd(27)}${right(rightText, 21)}\r\n`;
  const itemRow = (name, quantity, unit, amount) => `${fit(name, 20).padEnd(20)} ${right(quantity, 4)} ${right(unit, 9)} ${right(amount, 12)}\r\n`;
  const itemSubtotal = (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => {
    const unitValue = parseMoney(item.price);
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    return sum + (Number.isFinite(unitValue) ? unitValue * quantity : 0);
  }, 0);
  const couponDiscount = Math.max(0, Number(order.couponDiscount) || 0);
  const couponPercent = itemSubtotal > 0 && couponDiscount > 0 ? (couponDiscount / itemSubtotal) * 100 : 0;
  const formatPercent = (value) => `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
  const couponApplied = Boolean(order.coupon && couponDiscount > 0);
  const couponLine = [topRow(`Coupon: ${couponApplied ? `${text(order.coupon)}${couponPercent > 0 ? ` (${formatPercent(couponPercent)})` : ""}` : "Not applied"}`, `${couponApplied ? "-" : ""}${currency(couponDiscount)}`)];
  const lines = [
    reset,
    left,
    topRow(design.tagline, "ORDER BILL"),
    logoLarge,
    `${fit(design.logoText, 9)}${normal}${right(order.id, 21)}\r\n`,
    normal,
    topRow("", dateLabel(order.date)),
    ...(design.showStatus ? [topRow("", `Status: ${order.status}`)] : []),
    `${separator}\r\n`,
    "BILLED TO\r\n",
    bold,
    `${fit(order.customerName, 48)}\r\n`,
    normal,
    ...(design.showPhone ? [`${fit(order.phone, 48)}\r\n`, ...(order.email ? [`${fit(order.email, 48)}\r\n`] : [])] : []),
    "\r\n",
    ...(design.showAddress ? ["DELIVERY ADDRESS\r\n", ...wrap(order.address || "Address provided at checkout", 48).map((line) => `${line}\r\n`)] : []),
    `${separator}\r\n`,
    `${"Item".padEnd(20)} ${"Qty".padStart(4)} ${"Unit".padStart(9)} ${"Amount".padStart(12)}\r\n`,
    `${separator}\r\n`,
  ];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const numericPrice = parseMoney(item.price);
    const price = currency(item.price);
    const amount = Number.isFinite(numericPrice) ? currency(numericPrice * quantity) : price;
    const itemLines = wrap(item.name, 22);
    lines.push(itemRow(itemLines[0], quantity, price, amount));
    itemLines.slice(1).forEach((line) => lines.push(itemRow(line, "", "", "")));
  }
  lines.push(
    "\r\n",
    `${solid}\r\n`,
    ...couponLine,
    bold,
    `Total amount (incl. tax)${right(currency(order.total), 23)}\r\n`,
    normal,
    `${separator}\r\n`,
    ...(design.showQrCode ? [qrMarker, `${center}Powered by Vestano\r\n`] : []),
    `${text(design.thankYouText)}\r\n`,
    left,
  );
  return lines.join("");
};

const runPowerShell = (scriptPath, receiptPath, printerName, logoPath, logoCachePath) => new Promise((resolve, reject) => {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, receiptPath, printerName, logoPath, logoCachePath], { windowsHide: true });
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve() : reject(new Error(errorOutput.trim() || `Windows printer exited with code ${code ?? "unknown"}`)));
});

const ensurePrinterWorker = (printerName, qrPath) => {
  if (printerWorker && printerWorker.exitCode === null && printerWorkerReady && printerWorkerName === printerName && printerWorkerQrPath === qrPath) return printerWorkerReady;
  if (printerWorker && printerWorker.exitCode === null && (printerWorkerName !== printerName || printerWorkerQrPath !== qrPath)) {
    printerWorker.kill();
    printerWorker = null;
    printerWorkerReady = null;
    printerWorkerName = "";
    printerWorkerQrPath = "";
  }
  const worker = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", printerWorkerScript, printerName, qrPath], { windowsHide: true });
  printerWorker = worker;
  printerWorkerName = printerName;
  printerWorkerQrPath = qrPath;
  let workerBuffer = "";
  const readyPromise = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (printerWorker === worker) printerWorkerReady = null;
      while (printerWorkerRequests.length) printerWorkerRequests.shift().reject(error);
      reject(error);
    };
    worker.once("error", fail);
    worker.once("close", (code) => {
      if (code !== 0) fail(new Error(`Printer worker exited with code ${code ?? "unknown"}`));
      else {
        if (printerWorker === worker) printerWorkerReady = null;
        while (printerWorkerRequests.length) printerWorkerRequests.shift().reject(new Error("Printer worker closed"));
      }
      if (printerWorker === worker) {
        printerWorker = null;
        printerWorkerName = "";
        printerWorkerQrPath = "";
      }
    });
    worker.stdout.on("data", (chunk) => {
      workerBuffer += chunk.toString();
      const lines = workerBuffer.split(/\r?\n/);
      workerBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line === "READY") resolve();
        else if (line === "OK") printerWorkerRequests.shift()?.resolve();
        else if (line.startsWith("ERR:")) printerWorkerRequests.shift()?.reject(new Error(line.slice(4)));
      }
    });
  });
  printerWorkerReady = readyPromise;
  return readyPromise;
};

const sendThroughPrinterWorker = async (payload, printerName, qrPath) => {
  await ensurePrinterWorker(printerName, qrPath);
  return new Promise((resolve, reject) => {
    printerWorkerRequests.push({ resolve, reject });
    printerWorker.stdin.write(`${payload.toString("base64")}\n`);
  });
};

const labelRate = (price) => {
  const amount = text(price).replace(/[^0-9.,]/g, "").trim();
  return amount ? `Rs. ${amount}` : "";
};

const labelFrp = (price) => {
  const amount = parseMoney(price);
  return Number.isFinite(amount) ? `FRP :${amount.toFixed(2)}` : "";
};

const makeBarcodeLabel = ({ productName, barcode, price, copies }) => {
  const esc = 0x1b;
  const gs = 0x1d;
  const cleanName = text(productName).slice(0, 32) || "Fanzzy product";
  const rate = labelRate(price);
  const digits = text(barcode).replace(/\D/g, "");
  const eanBody = digits.length === 13 ? digits.slice(0, 12) : digits.length === 12 ? digits : "";
  const ean8Body = digits.length === 8 ? digits.slice(0, 7) : "";
  const count = Math.min(100, Math.max(1, Math.floor(Number(copies) || 1)));
  const chunks = [Buffer.from([esc, 0x40])];
  for (let index = 0; index < count; index += 1) {
    chunks.push(
      Buffer.from([esc, 0x61, 0x01, esc, 0x45, 0x01]),
      Buffer.from("fanZZy\n", "ascii"),
      Buffer.from(`${cleanName}\n`, "ascii"),
      ...(rate ? [Buffer.from(`${rate}\n`, "ascii")] : []),
      Buffer.from([esc, 0x45, 0x00, gs, 0x48, 0x02, gs, 0x66, 0x00, gs, 0x68, 0x60, gs, 0x77, 0x02]),
    );
    if (eanBody) chunks.push(Buffer.concat([Buffer.from([gs, 0x6b, 0x02]), Buffer.from(eanBody, "ascii")]));
    else if (ean8Body) chunks.push(Buffer.concat([Buffer.from([gs, 0x6b, 0x03]), Buffer.from(ean8Body, "ascii")]));
    else if (/^\d{5}$/.test(text(barcode))) {
      const code128 = Buffer.from(`{B${digits}`, "ascii");
      chunks.push(Buffer.concat([Buffer.from([gs, 0x6b, 0x49, code128.length]), code128]));
    } else chunks.push(Buffer.from(`${text(barcode).slice(0, 24)}\n`, "ascii"));
    chunks.push(Buffer.from([0x0a, 0x0a, esc, 0x64, 0x04, gs, 0x56, 0x42, 0x00]));
  }
  return Buffer.concat(chunks);
};

const makeTscBarcodeLabel = ({ productName, barcode, price, copies }) => {
  const cleanName = text(productName).replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 22) || "Fanzzy product";
  const rate = labelFrp(price).slice(0, 18);
  const cleanBarcode = text(barcode).replace(/["\r\n]/g, "").trim().slice(0, 32);
  const digits = cleanBarcode.replace(/\D/g, "");
  const printedBarcode = digits || cleanBarcode;
  const barcodeContent = digits === cleanBarcode
    ? digits.length % 2 === 0
      ? `!105${digits}`
      : `!104${digits.slice(0, 1)}!099${digits.slice(1)}`
    : `!104${cleanBarcode}`;
  const count = Math.min(100, Math.max(1, Math.floor(Number(copies) || 1)));
  // Match the supplied BarTender/TSC jewellery-label PRN exactly. Coordinates
  // are measured from the right because every printable object is rotated 180°.
  return Buffer.from([
    "SIZE 82 mm, 12 mm",
    "DIRECTION 0,0",
    "REFERENCE 0,0",
    "OFFSET 0 mm",
    "SET PEEL OFF",
    "SET CUTTER OFF",
    "SET PARTIAL_CUTTER OFF",
    "SET TEAR ON",
    "CLS",
    `BARCODE 422,86,"128M",37,0,180,2,4,"${barcodeContent}"`,
    "CODEPAGE 1252",
    `TEXT 411,43,"ROMAN.TTF",180,1,12,"${printedBarcode}"`,
    ...(rate ? [`TEXT 587,31,"ROMAN.TTF",180,1,8,"${rate}"`] : []),
    `TEXT 619,91,"ROMAN.TTF",180,1,9,"fanZZy"`,
    `TEXT 619,64,"ROMAN.TTF",180,1,8,"${cleanName}"`,
    `PRINT 1,${count}`,
    "",
  ].join("\r\n"), "ascii");
};

const printBarcodeLabel = async (productName, barcode, price, copies, requestedPrinter) => {
  const configured = text(requestedPrinter);
  const printerName = (configured === "Essae PR 55" ? defaultPrinter : configured) || defaultPrinter;
  const payload = /\bTSC\b|TTP[- ]?244/i.test(printerName)
    ? makeTscBarcodeLabel({ productName, barcode, price, copies })
    : makeBarcodeLabel({ productName, barcode, price, copies });
  await sendThroughPrinterWorker(payload, printerName, "");
  return printerName;
};

const printBarcodeLabels = async (items, requestedPrinter) => {
  const configured = text(requestedPrinter);
  const printerName = (configured === "Essae PR 55" ? defaultPrinter : configured) || defaultPrinter;
  const isTsc = /\bTSC\b|TTP[- ]?244/i.test(printerName);
  const payloads = items.map((item) => isTsc
    ? makeTscBarcodeLabel(item)
    : makeBarcodeLabel(item));
  await sendThroughPrinterWorker(Buffer.concat(payloads), printerName, "");
  return printerName;
};

const listWindowsPrinters = () => new Promise((resolve, reject) => {
  const command = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$printers = @(Get-Printer | Sort-Object Name | ForEach-Object { [PSCustomObject]@{ name = $_.Name; status = [string]$_.PrinterStatus; portName = $_.PortName; driverName = $_.DriverName } })",
    "ConvertTo-Json -InputObject $printers -Compress",
  ].join("; ");
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true });
  let output = "";
  let errorOutput = "";
  const timeout = setTimeout(() => child.kill(), 15000);
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("close", (code) => {
    clearTimeout(timeout);
    if (code !== 0) return reject(new Error(errorOutput.trim() || "Could not list Windows printers."));
    try {
      const printers = JSON.parse(output || "[]");
      resolve(Array.isArray(printers) ? printers : [printers]);
    } catch {
      reject(new Error("Windows returned an invalid printer list."));
    }
  });
});

const printOrder = async (order, requestedPrinter, design) => {
  const configured = text(requestedPrinter);
  const printerName = (configured === "Essae PR 55" ? defaultPrinter : configured) || defaultPrinter;
  const configuredDesign = { ...defaultBillDesign, ...(design || {}) };
  const workDir = await mkdtemp(join(tmpdir(), "fanzzy-print-"));
  const receiptPath = join(workDir, "receipt.txt");
  const scriptPath = join(workDir, "print.ps1");
  let logoPath = configuredDesign.showLogo && configuredDesign.logoAsset === "fanzzy-mark.png" ? thermalLogoImagePath : "";
  let logoCachePath = "";
  if (configuredDesign.showLogo && logoPath) {
    logoCachePath = join(logoCacheDirectory, "fanzzy-mark-v4.bin");
  }
  if (configuredDesign.showLogo && configuredDesign.logoAsset === "custom" && typeof configuredDesign.logoDataUrl === "string") {
    const match = configuredDesign.logoDataUrl.match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/);
    if (match) {
      logoPath = join(workDir, "uploaded-logo");
      logoCachePath = join(logoCacheDirectory, `v4-${createHash("sha1").update(configuredDesign.logoDataUrl).digest("hex")}.bin`);
      await writeFile(logoPath, Buffer.from(match[1], "base64"));
    }
  }
  let qrPath = configuredDesign.showQrCode ? qrImagePath : "";
  if (configuredDesign.showQrCode && configuredDesign.qrCodeAsset === "custom" && typeof configuredDesign.qrCodeDataUrl === "string") {
    const match = configuredDesign.qrCodeDataUrl.match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/);
    if (match) {
      qrPath = join(logoCacheDirectory, `qr-${createHash("sha1").update(configuredDesign.qrCodeDataUrl).digest("hex")}.png`);
      if (!await access(qrPath).then(() => true).catch(() => false)) await writeFile(qrPath, Buffer.from(match[1], "base64"));
    }
  }
  await mkdir(logoCacheDirectory, { recursive: true });
  const receipt = makeReceipt(order, configuredDesign);
  const logoReady = !logoCachePath || await access(logoCachePath).then(() => true).catch(() => false);
  if (logoReady && printerName === defaultPrinter) {
    try {
      const logo = logoCachePath ? await readFile(logoCachePath) : Buffer.alloc(0);
      const cut = Buffer.from([0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00]);
      await sendThroughPrinterWorker(Buffer.concat([logo, Buffer.from(receipt, "utf8"), cut]), printerName, qrPath);
      return printerName;
    } catch {
      // Fall back to the one-shot PowerShell path if the persistent worker is unavailable.
    }
  }
  const script = String.raw`param([string]$ReceiptPath, [string]$PrinterName, [string]$LogoPath, [string]$LogoCachePath)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FanzzyRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName = "Fanzzy Bill"; public string pOutputFile = null; public string pDataType = "RAW"; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr handle);
}
"@
$handle = [IntPtr]::Zero
if (-not [FanzzyRawPrinter]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) { throw "Could not open printer: $PrinterName" }
try {
  $doc = New-Object FanzzyRawPrinter+DOCINFO
  if ([FanzzyRawPrinter]::StartDocPrinter($handle, 1, $doc) -eq 0) { throw "Could not start printer job" }
  try {
    if (-not [FanzzyRawPrinter]::StartPagePrinter($handle)) { throw "Could not start printer page" }
    try {
      $receipt = [System.IO.File]::ReadAllBytes($ReceiptPath)
      $logo = [byte[]]@()
      if ($LogoCachePath -and (Test-Path -LiteralPath $LogoCachePath)) {
        $logo = [System.IO.File]::ReadAllBytes($LogoCachePath)
      } elseif ($LogoPath -and (Test-Path -LiteralPath $LogoPath)) {
        Add-Type -AssemblyName System.Drawing
        $source = [System.Drawing.Bitmap]::FromFile($LogoPath)
        try {
          $minX = $source.Width; $minY = $source.Height; $maxX = -1; $maxY = -1
          for ($y = 0; $y -lt $source.Height; $y++) {
            for ($x = 0; $x -lt $source.Width; $x++) {
              $pixel = $source.GetPixel($x, $y)
              if ($pixel.A -gt 20 -and ($pixel.R -lt 245 -or $pixel.G -lt 245 -or $pixel.B -lt 245)) { if ($x -lt $minX) { $minX = $x }; if ($y -lt $minY) { $minY = $y }; if ($x -gt $maxX) { $maxX = $x }; if ($y -gt $maxY) { $maxY = $y } }
            }
          }
          if ($maxX -ge $minX -and $maxY -ge $minY) {
            $cropWidth = $maxX - $minX + 1; $cropHeight = $maxY - $minY + 1
            $logoWidth = 148; $logoHeight = if ($LogoPath -like '*fanzzy-mark-thermal.png') { 151 } else { [Math]::Max(1, [int][Math]::Round($cropHeight * $logoWidth / $cropWidth)) }
            $target = [System.Drawing.Bitmap]::new($logoWidth, $logoHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $graphics = [System.Drawing.Graphics]::FromImage($target)
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
            $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $logoWidth, $logoHeight), $minX, $minY, $cropWidth, $cropHeight, [System.Drawing.GraphicsUnit]::Pixel)
            $graphics.Dispose()
            $bytesPerRow = [int][Math]::Ceiling($logoWidth / 8.0)
            $raster = New-Object byte[] ($bytesPerRow * $logoHeight)
            for ($y = 0; $y -lt $logoHeight; $y++) { for ($x = 0; $x -lt $logoWidth; $x++) { $pixel = $target.GetPixel($x, $y); $gray = (0.299 * $pixel.R) + (0.587 * $pixel.G) + (0.114 * $pixel.B); if ($gray -lt 128) { $index = ($y * $bytesPerRow) + [int]($x / 8); $raster[$index] = [byte]($raster[$index] -bor (1 -shl (7 - ($x % 8)))) } } }
            $target.Dispose()
            $header = [byte[]](0x1D, 0x76, 0x30, 0x00, [byte]($bytesPerRow -band 0xFF), [byte](($bytesPerRow -shr 8) -band 0xFF), [byte]($logoHeight -band 0xFF), [byte](($logoHeight -shr 8) -band 0xFF))
            $prefix = [byte[]](0x1B, 0x61, 0x01); $suffix = [byte[]](0x0A, 0x0A)
            $logo = New-Object byte[] ($prefix.Length + $header.Length + $raster.Length + $suffix.Length)
            [Array]::Copy($prefix, 0, $logo, 0, $prefix.Length); [Array]::Copy($header, 0, $logo, $prefix.Length, $header.Length); [Array]::Copy($raster, 0, $logo, $prefix.Length + $header.Length, $raster.Length); [Array]::Copy($suffix, 0, $logo, $prefix.Length + $header.Length + $raster.Length, $suffix.Length)
            if ($LogoCachePath) { [System.IO.File]::WriteAllBytes($LogoCachePath, $logo) }
          }
        } finally { $source.Dispose() }
      }
      $cut = [byte[]](0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x00)
      $payload = New-Object byte[] ($logo.Length + $receipt.Length + $cut.Length)
      [Array]::Copy($logo, 0, $payload, 0, $logo.Length)
      [Array]::Copy($receipt, 0, $payload, $logo.Length, $receipt.Length)
      [Array]::Copy($cut, 0, $payload, $logo.Length + $receipt.Length, $cut.Length)
      $written = 0
      if (-not [FanzzyRawPrinter]::WritePrinter($handle, $payload, $payload.Length, [ref]$written) -or $written -ne $payload.Length) { throw "Could not send the bill to the printer" }
    } finally { [FanzzyRawPrinter]::EndPagePrinter($handle) | Out-Null }
  } finally { [FanzzyRawPrinter]::EndDocPrinter($handle) | Out-Null }
} finally { [FanzzyRawPrinter]::ClosePrinter($handle) | Out-Null }`;
  try {
    await writeFile(receiptPath, receipt, "utf8");
    await writeFile(scriptPath, script, "utf8");
    await runPowerShell(scriptPath, receiptPath, printerName, logoPath, logoCachePath);
    return printerName;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const send = (response, status, payload) => {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
};

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true, printerName: defaultPrinter });
  if (request.method === "GET" && request.url?.startsWith("/print-preview/")) {
    const previewId = request.url.slice("/print-preview/".length).split(/[?#]/, 1)[0];
    const preview = barcodePrintPreviews.get(previewId);
    if (!preview || preview.expiresAt < Date.now()) {
      barcodePrintPreviews.delete(previewId);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return response.end("This barcode print preview has expired.");
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
    });
    return response.end(preview.markup);
  }
  if (request.method === "GET" && request.url === "/printers") {
    try {
      return send(response, 200, { printers: await listWindowsPrinters() });
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : "Could not list Windows printers." });
    }
  }
  if (request.method !== "POST" || !["/print", "/print-barcode", "/print-barcodes", "/prepare-printer"].includes(request.url || "")) return send(response, 404, { error: "Not found" });
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    if (request.url === "/prepare-printer") {
      const printerName = text(payload.printerName) || defaultPrinter;
      await ensurePrinterWorker(printerName, "");
      return send(response, 200, { ready: true, printerName });
    }
    if (request.url === "/print-barcode") {
      if (!text(payload.productName) || !text(payload.barcode)) return send(response, 400, { error: "Product name and barcode are required." });
      if (!/^\d{5}$/.test(text(payload.barcode))) return send(response, 400, { error: "Barcode must be exactly five digits." });
      openBrowserBarcodePrint([payload]);
      return send(response, 200, { printed: true, printerName: text(payload.printerName) || defaultPrinter, printDialog: true });
    }
    if (request.url === "/print-barcodes") {
      const items = Array.isArray(payload.items) ? payload.items.filter((item) => text(item?.productName) && text(item?.barcode)) : [];
      const printedLabels = items.reduce((sum, item) => sum + Math.min(100, Math.max(1, Math.floor(Number(item.copies) || 1))), 0);
      if (!items.length) return send(response, 400, { error: "Select at least one product with a barcode." });
      if (items.some((item) => !/^\d{5}$/.test(text(item.barcode)))) return send(response, 400, { error: "Every barcode must be exactly five digits." });
      if (items.length > 500 || printedLabels > 1000) return send(response, 400, { error: "A barcode batch can contain up to 500 products or 1000 labels." });
      openBrowserBarcodePrint(items);
      return send(response, 200, { printed: true, printerName: text(payload.printerName) || defaultPrinter, printedProducts: items.length, printedLabels, printDialog: true });
    }
    if (!payload.order?.id) return send(response, 400, { error: "Order details are required." });
    const printerName = await printOrder(payload.order, payload.printerName, payload.design);
    return send(response, 200, { printed: true, printerName });
  } catch (error) {
    return send(response, 500, { error: error instanceof Error ? error.message : "Could not print the bill." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fanzzy printer bridge listening on http://127.0.0.1:${port}`);
});
