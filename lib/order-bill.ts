export type BillOrder = {
  id: string;
  date: string;
  status: string;
  total: string;
  customerName: string;
  phone: string;
  email?: string;
  address?: string;
  coupon?: string;
  items?: Array<{ name: string; quantity: number; price: string }>;
};

export type BillDesignSettings = {
  showLogo: boolean;
  logoAsset: "fanzzy-mark.png" | "custom";
  logoDataUrl?: string;
  logoText: string;
  tagline: string;
  separator: "dotted" | "dashed";
  showQrCode: boolean;
  qrCodeAsset: "vestano-retail-qr-code.png" | "custom";
  qrCodeDataUrl?: string;
  showStatus: boolean;
  showPhone: boolean;
  showAddress: boolean;
  thankYouText: string;
};

export const defaultBillDesignSettings: BillDesignSettings = {
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

const billDesignSettings = (): BillDesignSettings => {
  if (typeof window === "undefined") return defaultBillDesignSettings;
  try {
    const stored = JSON.parse(window.localStorage.getItem("fanzzy-bill-design") || "null") as Partial<BillDesignSettings> | null;
    return { ...defaultBillDesignSettings, ...(stored || {}) };
  } catch {
    return defaultBillDesignSettings;
  }
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const printableBillMarkup = (order: BillOrder, design: BillDesignSettings, origin: string) => {
  const logo = design.showLogo
    ? design.logoAsset === "custom" && design.logoDataUrl
      ? `<img class="bill-logo receipt-logo" src="${escapeHtml(design.logoDataUrl)}" alt="" />`
      : `<img class="bill-logo receipt-logo" src="${escapeHtml(`${origin}/fanzzy-mark-thermal.png`)}" alt="" />`
    : "";
  const qrSource = design.showQrCode === false ? "" : design.qrCodeAsset === "custom" && design.qrCodeDataUrl
    ? design.qrCodeDataUrl
    : `${origin}/vestano-retail-qr-code.png`;
  const qrCode = qrSource ? `<section class="qr-section"><img class="receipt-qr" src="${escapeHtml(qrSource)}" alt="Vestano QR code" /><div>Powered by <strong>Vestano</strong></div></section>` : "";
  const items = (order.items || []).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${Math.max(1, Number(item.quantity) || 1)}</td><td>${escapeHtml(item.price)}</td></tr>`).join("");
  const separator = design.separator === "dashed" ? "dashed" : "dotted";
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(order.id)} · Fanzzy bill</title><style>
    @page { margin: 0; size: 80mm auto; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 80mm; }
    body { background: #fff; color: #241b1e; font-family: Arial, Helvetica, sans-serif; font-size: 11px; padding: 7mm 5mm; }
    .bill { width: 70mm; }
    .bill-head { border-bottom: 1px ${separator} #9b8589; padding-bottom: 5mm; text-align: center; }
    .bill-logo { display: block; height: 22mm; margin: 0 auto 2mm; max-width: 55mm; object-fit: contain; }
    .brand { color: #551a2d; font-family: Georgia, serif; font-size: 24px; font-weight: 700; }
    .tagline, .eyebrow, .muted { color: #775f66; font-size: 8px; letter-spacing: .12em; text-transform: uppercase; }
    .tagline { margin-top: 2mm; }
    .bill-meta { display: flex; justify-content: space-between; margin: 4mm 0; }
    .bill-section { border-bottom: 1px ${separator} #9b8589; padding: 3mm 0; }
    .bill-section p { margin: 1mm 0; }
    .bill-section strong { color: #551a2d; }
    table { border-collapse: collapse; margin: 3mm 0; width: 100%; }
    th { color: #775f66; font-size: 8px; font-weight: 400; text-align: left; text-transform: uppercase; }
    th:not(:first-child), td:not(:first-child) { text-align: right; }
    td { border-top: 1px solid #eadfd9; padding: 2.5mm 0; vertical-align: top; }
    td:first-child { max-width: 42mm; overflow-wrap: anywhere; }
    .total { color: #551a2d; display: flex; font-size: 16px; font-weight: 700; justify-content: space-between; padding: 4mm 0; }
    .qr-section { border-top: 1px dotted #9b8589; margin-top: 4mm; padding-top: 4mm; text-align: center; }
    .qr-section img { display: block; height: 28mm; margin: 0 auto 2mm; width: 28mm; }
    .qr-section div { color: #775f66; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }
    .qr-section strong { color: #551a2d; font-weight: 700; }
    .receipt-logo, .receipt-qr { image-rendering: pixelated; image-rendering: crisp-edges; filter: none; }
    .thanks { color: #775f66; line-height: 1.5; padding-top: 5mm; text-align: center; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body><main class="bill" data-receipt-element>
    <header class="bill-head">${logo}<div class="brand">${escapeHtml(design.logoText)}</div><div class="tagline">${escapeHtml(design.tagline)}</div></header>
    <div class="bill-meta"><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.date)}</span></div>
    ${design.showStatus ? `<div class="muted">Status: ${escapeHtml(order.status)}</div>` : ""}
    <section class="bill-section"><div class="eyebrow">Billed to</div><p><strong>${escapeHtml(order.customerName)}</strong></p>${design.showPhone ? `<p>${escapeHtml(order.phone)}</p>${order.email ? `<p>${escapeHtml(order.email)}</p>` : ""}` : ""}</section>
    ${design.showAddress ? `<section class="bill-section"><div class="eyebrow">Delivery address</div><p>${escapeHtml(order.address || "Address provided at checkout")}</p></section>` : ""}
    <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>${items}</tbody></table>
    <div class="total"><span>Total</span><span>${escapeHtml(order.total)}</span></div>
    ${qrCode}
    <div class="thanks">${escapeHtml(design.thankYouText)}</div>
  </main></body></html>`;
};

const waitForReceiptImages = async () => {
  const receiptElement = document.querySelector<HTMLElement>("[data-receipt-element]");
  if (!receiptElement) return;
  await Promise.all(
    Array.from(receiptElement.querySelectorAll("img")).map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error("Receipt image failed to load"));
            })
    )
  );
};

export const printOrderBill = async (order: BillOrder) => {
  if (typeof window === "undefined") return false;

  await waitForReceiptImages();

  const payload = JSON.stringify({
    order,
    printerName: "Essae PR-55",
    design: billDesignSettings(),
  });
  const requests = [
    () => fetch("http://127.0.0.1:3002/print", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: payload,
    }),
    () => fetch("/api/print-bill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }),
  ];

  for (const request of requests) {
    try {
      const response = await request();
      if (response.ok) return true;
    } catch {
      // Try the server-side proxy when the direct local bridge is unavailable.
    }
  }
  return false;
};
