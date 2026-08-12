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

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));

export const printOrderBill = (order: BillOrder) => {
  if (typeof window === "undefined") return false;
  const billWindow = window.open("", "_blank", "width=820,height=1000");
  if (!billWindow) return false;
  const items = order.items?.length
    ? order.items
        .map(
          (item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${escapeHtml(item.price)}</td><td>${escapeHtml(item.price)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4">Order details available in your confirmation.</td></tr>`;
  billWindow.document.write(`<!doctype html><html><head><title>Fanzzy bill ${escapeHtml(order.id)}</title><style>
    :root{color:#351322;font-family:Arial,sans-serif}*{box-sizing:border-box}body{margin:0;background:#f7f1eb;color:#351322}.sheet{background:#fff;max-width:760px;margin:32px auto;padding:48px;box-shadow:0 8px 30px #35132218}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #decfc8;padding-bottom:28px}.brand{font-family:Georgia,serif;font-size:38px}.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#805d6b}.meta{text-align:right;font-size:13px;line-height:1.7}.customer{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:28px 0;border-bottom:1px solid #decfc8}.customer h2{font-family:Georgia,serif;font-size:24px;font-weight:400;margin:6px 0 12px}.customer p{font-size:13px;line-height:1.6;margin:0;white-space:pre-line}table{border-collapse:collapse;width:100%;margin-top:28px;font-size:13px}th,td{border-bottom:1px solid #eadfd8;padding:13px 8px;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#805d6b}.total{display:flex;justify-content:space-between;max-width:280px;margin:28px 0 0 auto;border-top:2px solid #351322;padding-top:14px;font-weight:700;font-size:18px}.note{border-top:1px solid #decfc8;margin-top:40px;padding-top:20px;color:#805d6b;font-size:12px;line-height:1.6}@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:20px}}
  </style></head><body><main class="sheet"><header class="top"><div><div class="eyebrow">Jewellery with intention</div><div class="brand">fanZZy</div></div><div class="meta"><strong>ORDER BILL</strong><br>${escapeHtml(order.id)}<br>${escapeHtml(formatDate(order.date))}<br>Status: ${escapeHtml(order.status)}</div></header><section class="customer"><div><div class="eyebrow">Billed to</div><h2>${escapeHtml(order.customerName)}</h2><p>${escapeHtml(order.phone)}${order.email ? `\n${escapeHtml(order.email)}` : ""}</p></div><div><div class="eyebrow">Delivery address</div><p>${escapeHtml(order.address || "Address provided at checkout")}</p></div></section><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${items}</tbody></table><div class="total"><span>Total paid</span><strong>${escapeHtml(order.total)}</strong></div>${order.coupon ? `<div class="note">Coupon applied: ${escapeHtml(order.coupon)}</div>` : ""}<div class="note">Thank you for shopping with Fanzzy. Please keep this bill for your order records.</div></main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`);
  billWindow.document.close();
  billWindow.focus();
  return true;
};
