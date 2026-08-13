const required = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment values: ${missing.join(", ")}`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
const razorpayHeaders = { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}` };
const from = Math.floor(new Date(process.argv.find((argument) => argument.startsWith("--from="))?.slice(7) || "2024-01-01T00:00:00Z").getTime() / 1000);
const asMoney = (amount) => `₹${Math.round(Number(amount || 0) / 100).toLocaleString("en-IN")}`;

const ordersResponse = await fetch(`${supabaseUrl}/rest/v1/store_settings?key=eq.orders&select=value`, { headers: supabaseHeaders });
if (!ordersResponse.ok) throw new Error("Could not read stored orders");
const storedRows = await ordersResponse.json();
let orders = [];
try { orders = JSON.parse(storedRows[0]?.value || "[]"); } catch { orders = []; }
if (!Array.isArray(orders)) orders = [];

let created = 0;
let updated = 0;
let skip = 0;
while (true) {
  const paymentsResponse = await fetch(`https://api.razorpay.com/v1/payments?from=${from}&count=100&skip=${skip}`, { headers: razorpayHeaders });
  if (!paymentsResponse.ok) throw new Error("Could not read Razorpay payments");
  const page = await paymentsResponse.json();
  const payments = Array.isArray(page.items) ? page.items.filter((payment) => payment?.status === "captured" && payment?.id) : [];
  for (const payment of payments) {
    let order = orders.find((candidate) => candidate?.razorpayPaymentId === payment.id);
    if (order?.paymentStatus === "paid") continue;
    let razorpayOrder = null;
    if (payment.order_id) {
      const orderResponse = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(payment.order_id)}`, { headers: razorpayHeaders });
      if (orderResponse.ok) razorpayOrder = await orderResponse.json();
    }
    if (!order) order = orders.find((candidate) => candidate?.razorpayOrderId === payment.order_id);
    if (!order) {
      const receipt = String(razorpayOrder?.receipt || "").trim();
      const fanzzyId = /^#?FZ-[A-Z0-9-]+$/i.test(receipt) ? (receipt.startsWith("#") ? receipt : `#${receipt}`) : `#FZ-RZP-${payment.id.slice(-6).toUpperCase()}`;
      order = {
        id: fanzzyId,
        date: payment.created_at ? new Date(payment.created_at * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        status: "Processing",
        total: asMoney(payment.amount),
        customerName: payment.email?.split("@")[0] || "Razorpay customer",
        phone: payment.contact || "Not provided",
        email: payment.email || undefined,
        items: [],
      };
      orders.unshift(order);
      created += 1;
    } else updated += 1;
    order.paymentStatus = "paid";
    order.razorpayOrderId = payment.order_id || order.razorpayOrderId;
    order.razorpayPaymentId = payment.id;
    order.inventoryAdjusted = order.inventoryAdjusted ?? true;
  }
  if (!Array.isArray(page.items) || page.items.length < 100) break;
  skip += page.items.length;
}

const saveResponse = await fetch(`${supabaseUrl}/rest/v1/store_settings?on_conflict=key`, {
  method: "POST",
  headers: { ...supabaseHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([{ key: "orders", value: JSON.stringify(orders), updated_at: new Date().toISOString() }]),
});
if (!saveResponse.ok) throw new Error("Could not save reconciled orders");
console.log(JSON.stringify({ created, updated, totalOrders: orders.length }));
