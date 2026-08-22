"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useState } from "react";
import "../globals.css";
import "./vendor.css";

type Vendor = {
  business_name?: string;
  slug?: string;
  logo_url?: string;
  status?: string;
  owner_name?: string;
  login_email?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  city?: string;
  state?: string;
  pin_code?: string;
  gst_number?: string;
  pan_number?: string;
};

type Dashboard = {
  vendor?: Vendor;
  stats: Record<string, number>;
  products: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  payouts: Array<Record<string, unknown>>;
  notifications: Array<{ id: string; title: string; body: string }>;
  categories?: string[];
  offers?: Array<Record<string, unknown>>;
};

const money = (value: unknown) => `₹${(Number(value) || 0).toLocaleString("en-IN")}`;

function VendorLogin({ error, onSuccess }: { error?: string; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      const response = await fetch("/api/vendor-auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not sign in");
      onSuccess();
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : "Could not sign in");
    } finally {
      setLoading(false);
    }
  };

  return <main className="vendor-login-page"><a href="/" className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a><form className="vendor-login-card" onSubmit={submit}><p className="eyebrow">VENDOR PORTAL</p><h1>Welcome back.</h1><p>Sign in with the email and password provided by the Fanzzy admin team.</p><label>Login email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{(loginError || error) && <p className="vendor-error" role="alert">{loginError || error}</p>}<button className="button button-dark full-width" disabled={loading}>{loading ? "Signing in…" : "Sign in"} <span>↗</span></button><small>No email verification, OTP, or password-reset email is used. Contact admin if you need access.</small></form></main>;
}

export default function VendorDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Dashboard");
  const [form, setForm] = useState({ name: "", sku: "", category: "Uncategorised", price: "", stock: "", image: "", description: "" });
  const [message, setMessage] = useState("");

  const load = () => fetch("/api/vendor/dashboard", { cache: "no-store" }).then(async (response) => {
    const body = await response.json() as Dashboard & { error?: string };
    if (!response.ok) throw new Error(body.error || "Vendor authentication required.");
    setError("");
    setData(body);
  }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load dashboard."));

  useEffect(() => { void load(); }, []);

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/vendor/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, vendor_status: "Pending Approval", price: Number(form.price), stock: Number(form.stock) }) });
    const body = await response.json() as { error?: string };
    setMessage(body.error || "Product submitted for admin approval.");
    if (response.ok) { setForm({ name: "", sku: "", category: "Uncategorised", price: "", stock: "", image: "", description: "" }); void load(); }
  };

  const logout = async () => { await fetch("/api/vendor-auth/logout", { method: "POST" }).catch(() => undefined); window.location.assign("/vendor"); };

  if (error && !data) return <VendorLogin error={error} onSuccess={() => void load()} />;
  if (!data) return <main className="vendor-portal"><p>Loading vendor portal…</p></main>;

  const stats = data.stats || {};
  const navItems = ["Dashboard", "My Store", "Products", "Add Product", "Inventory", "Categories", "Offers", "Orders", "Returns", "Sales Reports", "Commission", "Payouts", "Notifications", "Profile", "Bank Details"];
  const statItems: Array<[string, unknown]> = [["Today’s sales", stats.grossSales], ["Net earnings", stats.netEarnings], ["Admin commission", stats.commission], ["Total orders", stats.totalOrders], ["New orders", stats.newOrders], ["Delivered", stats.deliveredOrders], ["Active products", stats.activeProducts], ["Low stock", stats.lowStockProducts], ["Out of stock", stats.outOfStockProducts]];
  const isMoney = (label: string) => /sales|earnings|commission/i.test(label);

  return <main className="vendor-portal"><aside className="vendor-sidebar"><a href="/" className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a><p className="vendor-sidebar-name">{data.vendor?.business_name}</p>{navItems.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}<button onClick={() => void logout()}>Logout ↪</button></aside><section className="vendor-portal-content"><header className="vendor-portal-header"><div><p className="eyebrow">VENDOR DASHBOARD</p><h1>{tab}</h1></div><span className="vendor-status">{data.vendor?.status}</span></header>
    {tab === "Add Product" && <form className="vendor-form-card" onSubmit={saveProduct}><h2>Submit a product</h2><p>New vendor products stay hidden until an admin approves them.</p><div className="vendor-form-grid"><label>Product name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>SKU<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required /></label><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="Uncategorised">Uncategorised</option>{(data.categories || []).map((category) => <option value={category} key={category}>{category}</option>)}</select></label><label>Price<input type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required /></label><label>Stock<input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required /></label><label>Image URL<input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} /></label><label className="vendor-form-wide">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>{message && <p className="vendor-message">{message}</p>}<button className="button button-dark">Submit for approval <span>↗</span></button></form>}
    {tab === "Categories" && <section className="vendor-data-card"><h2>Categories available for vendor products</h2><div className="vendor-chip-list">{(data.categories || []).map((category) => <span className="vendor-chip" key={category}>{category}</span>)}</div>{!data.categories?.length && <p className="muted">No categories have been configured by admin yet.</p>}</section>}
    {tab === "Offers" && <section className="vendor-data-card"><h2>Current store offers</h2>{(data.offers || []).map((offer, index) => <div className="vendor-data-row" key={String(offer.id || offer.code || index)}><span><strong>{String(offer.name || offer.title || offer.code || "Offer")}</strong><small>{String(offer.description || offer.detail || offer.status || "Configured by admin")}</small></span></div>)}{!data.offers?.length && <p className="muted">No active offers are available right now.</p>}</section>}
    {tab === "Profile" && <section className="vendor-data-card vendor-details-card"><h2>Vendor details</h2><p><strong>Business:</strong> {data.vendor?.business_name || "—"}</p><p><strong>Owner:</strong> {data.vendor?.owner_name || "—"}</p><p><strong>Login email:</strong> {data.vendor?.login_email || "—"}</p><p><strong>Phone:</strong> {data.vendor?.phone || "—"}</p><p><strong>WhatsApp:</strong> {data.vendor?.whatsapp || "—"}</p><p><strong>Address:</strong> {[data.vendor?.address, data.vendor?.city, data.vendor?.state, data.vendor?.pin_code].filter(Boolean).join(", ") || "—"}</p><p><strong>GST:</strong> {data.vendor?.gst_number || "—"}</p><p><strong>PAN:</strong> {data.vendor?.pan_number || "—"}</p></section>}
    {tab !== "Add Product" && tab !== "Categories" && tab !== "Offers" && tab !== "Profile" && <><div className="vendor-stat-grid">{statItems.map(([label, value]) => <article key={label}><small>{label}</small><strong>{isMoney(label) ? money(value) : String(value ?? 0)}</strong></article>)}</div><section className="vendor-data-card"><h2>{tab === "Products" || tab === "Inventory" ? "My products" : tab === "Orders" || tab === "Returns" ? "Vendor orders" : tab === "Payouts" ? "Payout history" : "Recent activity"}</h2>{(tab === "Products" || tab === "Inventory") && data.products.map((product) => <div className="vendor-data-row" key={String(product.sku)}><span><strong>{String(product.name)}</strong><small>{String(product.sku)} · {String(product.vendor_status || "Draft")}</small></span><b>{String(product.stock)} in stock</b></div>)}{(tab === "Orders" || tab === "Returns") && data.orders.map((order) => <div className="vendor-data-row" key={String(order.id)}><span><strong>{String(order.sub_order_number)}</strong><small>{String(order.status)} · {String(order.payment_status)}</small></span><b>{money(order.vendor_net_amount)}</b></div>)}{tab === "Payouts" && data.payouts.map((payout) => <div className="vendor-data-row" key={String(payout.id)}><span><strong>{String(payout.payout_number)}</strong><small>{String(payout.status)}</small></span><b>{money(payout.amount)}</b></div>)}{tab === "Notifications" && data.notifications.map((notification) => <div className="vendor-data-row" key={notification.id}><span><strong>{notification.title}</strong><small>{notification.body}</small></span></div>)}{!data.products.length && !data.orders.length && !data.payouts.length && <p className="muted">No records yet.</p>}</section></>}
  </section></main>;
}

