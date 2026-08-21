import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
let printerWorker = null;
let printerWorkerReady = null;
let printerWorkerQrPath = "";
let printerWorkerBuffer = "";
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

const makeReceipt = (order, configuredDesign = {}) => {
  const design = { ...defaultBillDesign, ...configuredDesign };
  const currency = (value) => money(value).replace(/^[^0-9-]+/, "Rs.");
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
  const itemRow = (name, quantity, unit, amount) => `${fit(name, 27).padEnd(27)}${right(quantity, 5)}${right(unit, 8)}${right(amount, 8)}\r\n`;
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
    `${"Item".padEnd(27)}${"Qty".padStart(5)}${"Unit".padStart(8)}${"Amount".padStart(8)}\r\n`,
    `${separator}\r\n`,
  ];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const price = currency(item.price);
    const numericPrice = Number(price.replace(/[^0-9.-]/g, ""));
    const amount = Number.isFinite(numericPrice) ? `Rs.${(numericPrice * quantity).toLocaleString("en-IN")}` : price;
    const itemLines = wrap(item.name, 27);
    lines.push(itemRow(itemLines[0], quantity, price, amount));
    itemLines.slice(1).forEach((line) => lines.push(itemRow(line, "", "", "")));
  }
  lines.push(
    "\r\n",
    `${solid}\r\n`,
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
  if (printerWorker && printerWorker.exitCode === null && printerWorkerReady && printerWorkerQrPath === qrPath) return printerWorkerReady;
  if (printerWorker && printerWorker.exitCode === null && printerWorkerQrPath !== qrPath) {
    printerWorker.kill();
    printerWorker = null;
    printerWorkerReady = null;
    printerWorkerQrPath = "";
  }
  printerWorker = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", printerWorkerScript, printerName, qrPath], { windowsHide: true });
  printerWorkerQrPath = qrPath;
  printerWorkerBuffer = "";
  printerWorkerReady = new Promise((resolve, reject) => {
    const fail = (error) => {
      printerWorkerReady = null;
      while (printerWorkerRequests.length) printerWorkerRequests.shift().reject(error);
      reject(error);
    };
    printerWorker.once("error", fail);
    printerWorker.once("close", (code) => {
      if (code !== 0) fail(new Error(`Printer worker exited with code ${code ?? "unknown"}`));
      else {
        printerWorkerReady = null;
        while (printerWorkerRequests.length) printerWorkerRequests.shift().reject(new Error("Printer worker closed"));
      }
      printerWorker = null;
      printerWorkerQrPath = "";
    });
    printerWorker.stdout.on("data", (chunk) => {
      printerWorkerBuffer += chunk.toString();
      const lines = printerWorkerBuffer.split(/\r?\n/);
      printerWorkerBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line === "READY") resolve();
        else if (line === "OK") printerWorkerRequests.shift()?.resolve();
        else if (line.startsWith("ERR:")) printerWorkerRequests.shift()?.reject(new Error(line.slice(4)));
      }
    });
  });
  return printerWorkerReady;
};

const sendThroughPrinterWorker = async (payload, printerName, qrPath) => {
  await ensurePrinterWorker(printerName, qrPath);
  return new Promise((resolve, reject) => {
    printerWorkerRequests.push({ resolve, reject });
    printerWorker.stdin.write(`${payload.toString("base64")}\n`);
  });
};

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
};

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true, printerName: defaultPrinter });
  if (request.method !== "POST" || request.url !== "/print") return send(response, 404, { error: "Not found" });
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    if (!payload.order?.id) return send(response, 400, { error: "Order details are required." });
    const printerName = await printOrder(payload.order, payload.printerName, payload.design);
    return send(response, 200, { printed: true, printerName });
  } catch (error) {
    return send(response, 500, { error: error instanceof Error ? error.message : "Could not print the bill." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fanzzy printer bridge listening on http://127.0.0.1:${port}`);
  void ensurePrinterWorker(defaultPrinter, qrImagePath).catch(() => undefined);
});
