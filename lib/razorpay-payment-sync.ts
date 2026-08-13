type StoredOrder = {
  id: string;
  userId?: string;
  userEmail?: string;
  date: string;
  status: "Processing" | "Packed" | "Shipped" | "Delivered" | "Cancelled";
  total: string;
  customerName: string;
  phone: string;
  email?: string;
  address?: string;
  paymentStatus?: "pending" | "paid";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  inventoryAdjusted?: boolean;
  items?: Array<{ name: string; quantity: number; price: string; productId?: string }>;
};

export type RazorpayPayment = {
  id: string;
  order_id?: string;
  amount?: number;
  email?: string;
  contact?: string;
  created_at?: number;
  notes?: Record<string, unknown>;
};

const paymentAddress = (payment: RazorpayPayment) => {
  const address = payment.notes?.address;
  return typeof address === "string" && address.trim() ? address.trim() : undefined;
};

const customerEmail = (email?: string) => {
  const normalized = email?.trim();
  // Razorpay uses this placeholder for some payment methods. It is not the customer's email.
  return normalized && !normalized.toLowerCase().endsWith("@razorpay.com") ? normalized : undefined;
};

const restorePaymentContactDetails = (order: StoredOrder, payment: RazorpayPayment) => {
  const address = paymentAddress(payment);
  const email = customerEmail(payment.email);
  if (payment.contact?.trim()) order.phone = payment.contact.trim();
  if (address) order.address = address;
  if (email) order.email = email;
  if (!email && order.email?.toLowerCase().endsWith("@razorpay.com")) delete order.email;
  if (!email && order.customerName === payment.email?.split("@")[0]) order.customerName = "Razorpay customer";
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pdrcrkxeyqxqgpwfxqpu.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || "sb_publishable_OTSfS6G2tlrAGINfyY3VGA_yi_3BPAV";

const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  "Content-Type": "application/json",
};

const asMoney = (amountPaise: number) => `₹${Math.round(amountPaise / 100).toLocaleString("en-IN")}`;
const asOrderId = (payment: RazorpayPayment, receipt?: string) => {
  const notedId = typeof payment.notes?.fanzzy_order_id === "string" ? payment.notes.fanzzy_order_id.trim() : "";
  if (/^#FZ-[A-Z0-9-]+$/i.test(notedId)) return notedId;
  const receiptId = String(receipt || "").trim();
  if (/^#?FZ-[A-Z0-9-]+$/i.test(receiptId)) return receiptId.startsWith("#") ? receiptId : `#${receiptId}`;
  return `#FZ-RZP-${payment.id.slice(-6).toUpperCase()}`;
};

async function readOrders() {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?key=eq.orders&select=value`, { headers });
  if (!response.ok) throw new Error("Could not read saved orders");
  const rows = await response.json() as Array<{ value?: string }>;
  try {
    const parsed = JSON.parse(rows[0]?.value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed as StoredOrder[] : [];
  } catch {
    return [] as StoredOrder[];
  }
}

async function writeOrders(orders: StoredOrder[]) {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: "orders", value: JSON.stringify(orders), updated_at: new Date().toISOString() }]),
  });
  if (!response.ok) throw new Error("Could not save the paid order");
}

async function adjustInventory(order: StoredOrder) {
  const quantities = new Map<string, number>();
  order.items?.forEach((item) => {
    const sku = String(item.productId || "").trim();
    if (sku && item.quantity > 0) quantities.set(sku, (quantities.get(sku) || 0) + Math.floor(item.quantity));
  });
  for (const [sku, quantity] of quantities) {
    const productResponse = await fetch(`${supabaseUrl}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}&select=sku,stock`, { headers });
    if (!productResponse.ok) throw new Error("Could not read product inventory");
    const products = await productResponse.json() as Array<{ stock?: number }>;
    const currentStock = Number(products[0]?.stock);
    if (!Number.isFinite(currentStock)) continue;
    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ stock: Math.max(0, currentStock - quantity), updated_at: new Date().toISOString() }),
    });
    if (!updateResponse.ok) throw new Error("Could not update product inventory");
  }
}

export async function finalizeRazorpayPayment(payment: RazorpayPayment, receipt?: string) {
  if (!payment.id) throw new Error("Razorpay payment ID is missing");
  const orders = await readOrders();
  let order = orders.find((candidate) => candidate.razorpayPaymentId === payment.id);
  if (order?.paymentStatus === "paid" && order.inventoryAdjusted !== false) {
    restorePaymentContactDetails(order, payment);
    await writeOrders(orders);
    return order;
  }

  if (!order) {
    order = orders.find((candidate) => candidate.razorpayOrderId && candidate.razorpayOrderId === payment.order_id);
  }
  if (!order) {
    order = {
      id: asOrderId(payment, receipt),
      date: payment.created_at ? new Date(payment.created_at * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      status: "Processing",
      total: asMoney(Number(payment.amount) || 0),
      customerName: customerEmail(payment.email)?.split("@")[0] || "Razorpay customer",
      phone: payment.contact || "Not provided",
      email: customerEmail(payment.email),
      address: paymentAddress(payment),
      items: [],
    };
    orders.unshift(order);
  }

  order.paymentStatus = "paid";
  order.razorpayOrderId = payment.order_id || order.razorpayOrderId;
  order.razorpayPaymentId = payment.id;
  restorePaymentContactDetails(order, payment);
  order.inventoryAdjusted = false;
  await writeOrders(orders);

  await adjustInventory(order);
  order.inventoryAdjusted = true;
  await writeOrders(orders);
  return order;
}
