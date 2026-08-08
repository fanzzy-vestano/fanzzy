"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { fetchCatalogCategories, fetchCatalogProducts, fetchStoreSetting, isSupabaseReady, removeCatalogCategory, removeCatalogProduct, renameCatalogCategory, saveCatalogCategory, saveCatalogProduct, saveStoreSetting, uploadStoreImage } from "../../lib/supabase/catalog";
import "../globals.css";
import "../brand-polish.css";
import "./admin.css";
import "./admin-polish.css";

type AdminProduct = { name: string; sku: string; category: string; stock: number; price: string; status: "Published" | "Draft" | "Low stock"; image: string };
type DateRange = "this-month" | "last-month" | "all-time";
type ProductFilter = "all" | "low-stock" | "drafts";

const adminProducts: AdminProduct[] = [
  { name: "Aurora Drop Earrings", sku: "LST-AUR-01", category: "Earrings", stock: 24, price: "₹1,290", status: "Published", image: "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=200&q=80" },
  { name: "Solstice Tennis Necklace", sku: "LST-SOL-02", category: "Necklaces", stock: 8, price: "₹2,480", status: "Low stock", image: "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=200&q=80" },
  { name: "Muse Sculpted Cuff", sku: "LST-MUS-03", category: "Bracelets", stock: 0, price: "₹1,860", status: "Draft", image: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=200&q=80" },
  { name: "Orbital Pearl Ring", sku: "LST-ORB-04", category: "Rings", stock: 41, price: "₹990", status: "Published", image: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=80" },
];
const defaultHeroImage = "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=90";
const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteAsset = (name: string) => `${siteBasePath}/${name}`;
const createSku = (name: string, category: string, existing: AdminProduct[]) => {
  const prefix = (name.replace(/[^a-zA-Z0-9]/g, "") || category.replace(/[^a-zA-Z0-9]/g, "") || "ITEM").toUpperCase().slice(0, 4);
  let number = existing.length + 1;
  let sku = `FZ-${prefix}-${String(number).padStart(3, "0")}`;
  while (existing.some((product) => product.sku === sku)) { number += 1; sku = `FZ-${prefix}-${String(number).padStart(3, "0")}`; }
  return sku;
};
const makeLocalImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
  reader.onload = () => {
    const image = new window.Image();
    image.onerror = () => reject(new Error("Could not process image"));
    image.onload = () => {
      const maxSize = 1000;
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/webp", 0.72));
    };
    image.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});
const persistCatalog = (catalog: AdminProduct[]) => {
  if (typeof window === "undefined") return;
  const tones = ["#d9c4bc", "#dad7ce", "#d0c2b0", "#e5ddd1"];
  const storefrontCatalog = catalog.map((product, index) => ({ id: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: product.name, sku: product.sku, category: product.category, stock: product.stock, status: product.status, price: Number(product.price.replace(/[^0-9]/g, "")) || 0, image: product.image, hoverImage: product.image, tag: product.status === "Draft" ? "Draft" : undefined, tone: tones[index % tones.length] }));
  try {
    window.localStorage.setItem("fanzzy-products", JSON.stringify(storefrontCatalog));
  } catch {
    // A large data URL must never crash the admin page when local storage is full.
    const compactCatalog = storefrontCatalog.map((product) => product.image.startsWith("data:") ? { ...product, image: "", hoverImage: "" } : product);
    try {
      window.localStorage.setItem("fanzzy-products", JSON.stringify(compactCatalog));
    } catch {
      try { window.localStorage.removeItem("fanzzy-products"); } catch { /* storage is unavailable */ }
    }
  }
  window.dispatchEvent(new Event("fanzzy-products-updated"));
};
const toCatalogProduct = (product: AdminProduct) => ({
  name: product.name,
  sku: product.sku,
  category: product.category,
  stock: product.stock,
  price: Number(product.price.replace(/[^0-9.]/g, "")) || 0,
  status: product.status,
  image: product.image,
  hoverImage: product.image,
});
const persistCategories = (categories: Array<{ name: string; pieces: number }>) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("fanzzy-categories", JSON.stringify(categories));
  window.dispatchEvent(new Event("fanzzy-categories-updated"));
};
const menu = [{ label: "Overview", icon: "◌" }, { label: "Products", icon: "◇", count: "24" }, { label: "Categories", icon: "▦" }, { label: "Collections", icon: "✧" }, { label: "Orders", icon: "↗", count: "12" }, { label: "Customers", icon: "♧" }, { label: "Marketing", icon: "◈" }, { label: "Homepage", icon: "⌂" }];

export default function AdminPage() {
  const [active, setActive] = useState("Overview");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("this-month");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const categories = useMemo(() => ["All categories", ...Array.from(new Set(adminProducts.map((product) => product.category)))], []);
  const shownProducts = useMemo(() => adminProducts.filter((product) => {
    const matchesQuery = `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = productFilter === "all" || (productFilter === "low-stock" && (product.stock < 10 || product.status === "Low stock")) || (productFilter === "drafts" && product.status === "Draft");
    const matchesCategory = categoryFilter === "All categories" || product.category === categoryFilter;
    return matchesQuery && matchesFilter && matchesCategory;
  }), [categoryFilter, productFilter, query]);
  const metrics = {
    "this-month": { revenue: "₹2,48,620", orders: "184", average: "₹1,351", customers: "78", growth: ["+18.4%", "+12.8%", "+6.2%", "+24.1%"] },
    "last-month": { revenue: "₹2,09,980", orders: "163", average: "₹1,286", customers: "63", growth: ["+9.6%", "+8.1%", "+4.8%", "+18.2%"] },
    "all-time": { revenue: "₹8,42,560", orders: "612", average: "₹1,377", customers: "246", growth: ["+21.7%", "+16.4%", "+7.1%", "+28.6%"] },
  }[dateRange];
  const dateLabels: Record<DateRange, string> = { "this-month": "This month", "last-month": "Last month", "all-time": "All time" };
  const notify = (message: string) => {
    if (message === "Preview opened") { window.location.assign(`${siteBasePath}/`); return; }
    if (message === "New product form opened" || message.endsWith(" selected")) setActive("Products");
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };
  return <main className="admin-shell">
    <aside className="admin-sidebar"><div className="admin-brand"><a href={`${siteBasePath}/`} className="wordmark"><img src={siteAsset("fanzzy-mark.png")} alt="Fanzzy" className="brand-logo" /><small>control room</small></a><span className="live-dot">LIVE</span></div><div className="admin-profile"><div className="avatar">VE</div><div><strong>Vestano</strong><small>Super admin</small></div><button onClick={() => notify("Profile menu opened")}>⌄</button></div><p className="admin-label">Workspace</p><nav className="admin-nav">{menu.map((item) => <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => setActive(item.label)}><span className="nav-icon">{item.icon}</span>{item.label}{item.count && <b>{item.count}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setActive("Settings")}><span className="nav-icon">⚙</span>Settings</button><a href={`${siteBasePath}/`}><span className="nav-icon">↩</span>View storefront</a></div></aside>
    <section className={`admin-content ${active !== "Overview" ? "module-active" : ""}`}><header className="admin-topbar"><div className="admin-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders, products, customers…" /></div><div className="admin-top-actions"><button onClick={() => notify("No new notifications")}>♢<i /></button><button onClick={() => notify("Preview opened")}>Preview store ↗</button><div className="mini-avatar">VE</div></div></header><div className="admin-page-heading"><div><p className="eyebrow">Saturday, 08 August 2026</p><h1>Good morning, Vestano <span>✦</span></h1><p className="subcopy">Here’s what’s happening across Fanzzy today.</p></div><label className="date-control"> <span>{dateLabels[dateRange]}</span><select aria-label="Dashboard date range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}><option value="this-month">This month</option><option value="last-month">Last month</option><option value="all-time">All time</option></select></label></div><AnnouncementPanel onNotify={notify} />{active !== "Overview" && <ModuleWorkspace module={active} onNotify={notify} />}<div className="stats-grid"><Stat label="Revenue" value={metrics.revenue} change={metrics.growth[0]} note={dateRange === "this-month" ? "vs. last month" : "selected period"} /><Stat label="Orders" value={metrics.orders} change={metrics.growth[1]} note={dateRange === "this-month" ? "vs. last month" : "selected period"} /><Stat label="Average order" value={metrics.average} change={metrics.growth[2]} note={dateRange === "this-month" ? "vs. last month" : "selected period"} /><Stat label="New customers" value={metrics.customers} change={metrics.growth[3]} note={dateRange === "this-month" ? "vs. last month" : "selected period"} /></div><div className="dashboard-grid"><section className="panel sales-panel"><div className="panel-heading"><div><p className="eyebrow">REVENUE OVERVIEW</p><h2>Sales performance</h2></div><div className="chart-legend"><span><i className="dot wine-dot" />{dateLabels[dateRange]}</span><span><i className="dot gold-dot" />Previous period</span></div></div><div className="chart-value">{metrics.revenue} <span>↑ {metrics.growth[0].slice(1)}</span></div><div className="sales-chart"><div className="chart-y"><span>₹3L</span><span>₹2L</span><span>₹1L</span><span>₹0</span></div><div className="chart-area"><div className="grid-lines"><i /><i /><i /><i /></div><svg viewBox="0 0 640 190" preserveAspectRatio="none" aria-label="Revenue trend chart"><path d="M0,152 C50,130 57,150 97,127 S147,119 188,136 S241,74 283,93 S338,109 370,88 S430,57 464,76 S519,79 552,40 S605,62 640,24" fill="none" stroke="#4b1c2b" strokeWidth="3" /><path d="M0,165 C52,144 75,158 100,151 S145,139 188,148 S241,116 283,128 S332,130 370,119 S430,104 464,120 S519,112 552,91 S605,101 640,73" fill="none" stroke="#c9a875" strokeWidth="2" strokeDasharray="5 5" /></svg><div className="chart-x"><span>01 Aug</span><span>07 Aug</span><span>14 Aug</span><span>21 Aug</span><span>28 Aug</span></div></div></div></section><section className="panel order-panel"><div className="panel-heading"><div><p className="eyebrow">LIVE PULSE</p><h2>Order status</h2></div><button className="panel-link" onClick={() => setActive("Orders")}>View all ↗</button></div><div className="order-ring"><div><strong>{metrics.orders}</strong><span>Total orders</span></div></div><div className="status-list"><Status color="wine" label="Delivered" value={dateRange === "this-month" ? "108" : dateRange === "last-month" ? "94" : "365"} /><Status color="gold" label="Processing" value={dateRange === "this-month" ? "34" : dateRange === "last-month" ? "29" : "117"} /><Status color="peach" label="Shipped" value={dateRange === "this-month" ? "28" : dateRange === "last-month" ? "25" : "86"} /><Status color="lavender" label="Pending" value={dateRange === "this-month" ? "14" : dateRange === "last-month" ? "15" : "44"} /></div></section></div><div className="lower-grid"><section className="panel products-panel"><div className="panel-heading"><div><p className="eyebrow">CATALOG HEALTH</p><h2>Product pulse</h2></div><button className="panel-link" onClick={() => setActive("Products")}>Manage catalog ↗</button></div><div className="table-tools"><div className="table-filters"><div className="table-tabs"><button className={productFilter === "all" ? "active" : ""} onClick={() => setProductFilter("all")}>All products <b>24</b></button><button className={productFilter === "low-stock" ? "active" : ""} onClick={() => setProductFilter("low-stock")}>Low stock <b>03</b></button><button className={productFilter === "drafts" ? "active" : ""} onClick={() => setProductFilter("drafts")}>Drafts <b>02</b></button></div><select className="category-filter" aria-label="Filter products by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></div><button className="add-product" onClick={() => notify("New product form opened")}>+ Add product</button></div><div className="product-table"><div className="table-row table-header"><span>Product</span><span>Category</span><span>Inventory</span><span>Price</span><span>Status</span><span /></div>{shownProducts.map((product) => <div className="table-row" key={product.sku}><div className="table-product"><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.sku}</small></span></div><span>{product.category}</span><span className={product.stock < 10 ? "low-stock" : ""}>{product.stock === 0 ? "Out of stock" : `${product.stock} in stock`}</span><span>{product.price}</span><span><i className={`status-pill ${product.status.toLowerCase().replace(" ", "-")}`}>{product.status}</i></span><button className="row-more" onClick={() => notify(`${product.name} selected`)}>•••</button></div>)}</div>{shownProducts.length === 0 && <p className="empty-filter">No products match these filters.</p>}</section><section className="panel todo-panel"><div className="panel-heading"><div><p className="eyebrow">ATTENTION NEEDED</p><h2>Your to-do list</h2></div><span className="task-count">4</span></div><Task label="Review 3 low stock products" tone="wine" onClick={() => { setProductFilter("low-stock"); setCategoryFilter("All categories"); }} /><Task label="Pack today’s 12 orders" tone="gold" onClick={() => setActive("Orders")} /><Task label="Approve 5 customer reviews" tone="lavender" onClick={() => notify("Reviews opened")} /><Task label="Schedule August campaign" tone="peach" onClick={() => setActive("Marketing")} /><div className="campaign-card"><span>✦</span><div><strong>Midnight Edit</strong><small>Campaign is live · 4 days left</small></div><button onClick={() => setActive("Marketing")}>↗</button></div></section></div><div className="admin-footer"><span>Fanzzy control room · v1.0</span><span>All systems operational <i className="status-light" /></span></div></section>{toast && <div className="admin-toast">{toast} <span>✦</span></div>}
  </main>;
}

function Stat({ label, value, change, note }: { label: string; value: string; change: string; note: string }) { return <div className="stat-card"><p className="eyebrow">{label}</p><strong>{value}</strong><div><span className="stat-change">↑ {change}</span><small>{note}</small></div></div>; }
function Status({ color, label, value }: { color: string; label: string; value: string }) { return <div className="status-item"><span><i className={`dot ${color}-dot`} />{label}</span><strong>{value}</strong></div>; }
function Task({ label, tone, onClick }: { label: string; tone: string; onClick: () => void }) { return <button className="task-row" onClick={onClick}><span className={`task-check ${tone}`} />{label}<span className="task-arrow">↗</span></button>; }

function AnnouncementPanel({ onNotify }: { onNotify: (message: string) => void }) {
  const [text, setText] = useState("Complimentary shipping on orders above ₹999");

  useEffect(() => {
    let active = true;
    const loadAnnouncement = async () => {
      const remote = await fetchStoreSetting("announcement");
      if (active && !remote.error && remote.value !== null) {
        setText(remote.value);
        window.localStorage.setItem("fanzzy-announcement", remote.value);
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-announcement");
      if (active && stored !== null) setText(stored);
    };
    void loadAnnouncement();
    return () => { active = false; };
  }, []);

  const saveAnnouncement = async () => {
    const nextText = text.trim();
    const remoteError = await saveStoreSetting("announcement", nextText);
    window.localStorage.setItem("fanzzy-announcement", nextText);
    window.dispatchEvent(new Event("fanzzy-announcement-updated"));
    onNotify(remoteError ? "Saved locally; Supabase needs its tables" : "Announcement updated on storefront");
  };

  return <section className="panel announcement-panel"><div><p className="eyebrow">STOREFRONT CONTENT</p><h2>Announcement bar</h2><p className="announcement-panel-copy">Edit the message shown above the Fanzzy header. Changes are saved to the shared storefront settings.</p></div><div className="announcement-editor"><input value={text} onChange={(event) => setText(event.target.value)} aria-label="Announcement bar text" /><button className="announcement-save" onClick={saveAnnouncement}>Save message</button></div></section>;
}

const moduleContent: Record<string, { eyebrow: string; title: string; description: string; primary: string; secondary: string; rows: string[] }> = {
  Products: { eyebrow: "CATALOG", title: "Product library", description: "Create, edit, price, and organise every piece in your storefront.", primary: "Add product", secondary: "Import CSV", rows: ["Aurora Drop Earrings · 24 in stock", "Solstice Tennis Necklace · 8 in stock", "Muse Sculpted Cuff · Draft", "Orbital Pearl Ring · 41 in stock"] },
  Categories: { eyebrow: "CATALOG", title: "Categories", description: "Keep collections easy to browse with clear category structure.", primary: "Add category", secondary: "Reorder", rows: ["Earrings · 42 pieces", "Necklaces · 28 pieces", "Bracelets · 18 pieces", "Rings · 24 pieces"] },
  Collections: { eyebrow: "MERCHANDISING", title: "Collections", description: "Shape the edits customers see across the Fanzzy storefront.", primary: "New collection", secondary: "Manage featured", rows: ["The Midnight Edit · Live", "Everyday Gold · 12 products", "Occasion pieces · 18 products", "Gifting · 9 products"] },
  Orders: { eyebrow: "OPERATIONS", title: "Orders", description: "Review new orders, update fulfilment, and keep customers informed.", primary: "View pending", secondary: "Export orders", rows: ["#FZ-1048 · Processing · ₹4,860", "#FZ-1047 · Packed · ₹2,480", "#FZ-1046 · Shipped · ₹1,290", "#FZ-1045 · Delivered · ₹3,120"] },
  Customers: { eyebrow: "RELATIONSHIPS", title: "Customers", description: "Understand your community and support every order with care.", primary: "Add customer", secondary: "Export list", rows: ["Amrita Mehra · 12 orders · ₹28,400", "Riya Sharma · 8 orders · ₹14,820", "Nisha Kapoor · 5 orders · ₹9,610", "Aarav Menon · 3 orders · ₹4,980"] },
  Marketing: { eyebrow: "GROWTH", title: "Marketing studio", description: "Manage campaigns, coupons, and the messages that bring customers back.", primary: "Create campaign", secondary: "New coupon", rows: ["August welcome offer · Active", "HELLOFANZZY · 10% off", "Weekend edit · Scheduled", "Newsletter · 1,284 subscribers"] },
  Homepage: { eyebrow: "CONTENT", title: "Homepage builder", description: "Control the sections, banners, and featured products on the storefront.", primary: "Add section", secondary: "Preview homepage", rows: ["Hero banner · Enabled", "Shop by mood · Enabled", "Curated products · Enabled", "Newsletter · Enabled"] },
  Settings: { eyebrow: "SYSTEM", title: "Store settings", description: "Configure store details, shipping, payments, theme, and team access.", primary: "Save settings", secondary: "View permissions", rows: ["Store profile · Configured", "Shipping rules · 3 active", "Payment methods · Razorpay ready", "Admin roles · 4 configured"] },
};

function ModuleWorkspace({ module, onNotify }: { module: string; onNotify: (message: string) => void }) {
  if (module === "Products") return <ProductLibraryWorkspace onNotify={onNotify} />;
  if (module === "Categories") return <CategoryWorkspace onNotify={onNotify} />;
  if (module === "Homepage") return <HomepageWorkspace onNotify={onNotify} />;
  const content = moduleContent[module] ?? { eyebrow: "WORKSPACE", title: module, description: `Manage ${module.toLowerCase()} from your Fanzzy control room.`, primary: "Create new", secondary: "View report", rows: ["Workspace ready", "No pending issues", "All systems operational"] };
  return <section className="panel module-workspace"><div className="module-workspace-head"><div><p className="eyebrow">{content.eyebrow}</p><h2>{content.title}</h2><p>{content.description}</p></div><div className="module-actions"><button className="module-secondary" onClick={() => onNotify(`${content.secondary} opened`)}>{content.secondary} ↗</button><button className="module-primary" onClick={() => onNotify(`${content.primary} opened`)}>+ {content.primary}</button></div></div><div className="module-summary"><span><i className="status-light" />Live workspace</span><span>{content.rows.length} active records</span></div><div className="module-list">{content.rows.map((row, index) => <button key={row} onClick={() => onNotify(`${row.split(" · ")[0]} selected`)}><span className="module-row-number">0{index + 1}</span><strong>{row.split(" · ")[0]}</strong><small>{row.split(" · ").slice(1).join(" · ")}</small><b>↗</b></button>)}</div></section>;
}

function HomepageWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [heroImage, setHeroImage] = useState(defaultHeroImage);
  const [pendingImage, setPendingImage] = useState(defaultHeroImage);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    let active = true;
    const loadHeroImage = async () => {
      const remote = await fetchStoreSetting("heroImage");
      const stored = remote.value || window.localStorage.getItem("fanzzy-hero-image");
      if (active && stored) { setHeroImage(stored); setPendingImage(stored); }
    };
    void loadHeroImage();
    return () => { active = false; };
  }, []);

  const uploadHeroImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    const reader = new FileReader();
    reader.onload = () => setPendingImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const saveHeroImage = async () => {
    let nextImage = pendingImage;
    let imageSavedLocally = false;
    if (pendingFile) {
      try { nextImage = await makeLocalImage(pendingFile); } catch { /* keep the preview */ }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(pendingFile, "homepage");
        if (upload.error || !upload.url) {
          imageSavedLocally = true;
        } else {
          nextImage = upload.url;
        }
      }
    }
    const remoteError = await saveStoreSetting("heroImage", nextImage);
    window.localStorage.setItem("fanzzy-hero-image", nextImage);
    window.dispatchEvent(new Event("fanzzy-hero-updated"));
    setHeroImage(nextImage);
    setPendingImage(nextImage);
    setPendingFile(null);
    onNotify(remoteError ? "Image saved locally; Supabase needs setup" : imageSavedLocally ? "Homepage image saved locally until storage is connected" : "Homepage hero image updated");
  };

  return <section className="panel module-workspace homepage-workspace"><div className="module-workspace-head"><div><p className="eyebrow">CONTENT</p><h2>Homepage builder</h2><p>Control the hero image and featured sections shown on the Fanzzy storefront.</p></div><div className="module-actions"><button className="module-secondary" onClick={() => window.location.assign("/")}>Preview homepage ↗</button><button className="module-primary" onClick={saveHeroImage}>Save changes</button></div></div><div className="homepage-hero-editor"><div className="homepage-hero-preview"><img src={pendingImage} alt="Homepage hero preview" /></div><div className="homepage-hero-copy"><p className="eyebrow">HERO BANNER</p><h3>Front page image</h3><p>Upload a new image to replace the main hero photo on the front page.</p><label className="hero-upload-button">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadHeroImage} /></label><small>{heroImage === pendingImage ? "Current image" : "Unsaved image change"}</small></div></div><div className="module-summary"><span><i className="status-light" />Live storefront sync</span><span>Hero banner · Enabled</span></div></section>;
}

function CategoryWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [categories, setCategories] = useState([
    { name: "Earrings", pieces: 42 },
    { name: "Necklaces", pieces: 28 },
    { name: "Bracelets", pieces: 18 },
    { name: "Rings", pieces: 24 },
  ]);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<{ name: string; pieces: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      const remote = await fetchCatalogCategories();
      if (active && !remote.error && remote.data) {
        setCategories(remote.data.map((category) => ({ name: category.name, pieces: category.pieces })));
        persistCategories(remote.data.map((category) => ({ name: category.name, pieces: category.pieces })));
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-categories");
      if (active && stored) {
        try { setCategories(JSON.parse(stored)); } catch { window.localStorage.removeItem("fanzzy-categories"); }
      }
    };
    void loadCategories();
    return () => { active = false; };
  }, []);
  const saveCategory = async () => {
    if (!name.trim()) return onNotify("Category name is required");
    const category = { name: name.trim(), pieces: 0 };
    const remoteError = await saveCatalogCategory(category);
    setCategories((current) => [...current, category]);
    persistCategories([...categories, category]);
    setName("");
    setIsAdding(false);
    onNotify(remoteError ? "Category saved locally; Supabase needs its tables" : `${category.name} category added`);
  };
  const openCategory = (category: { name: string; pieces: number }) => {
    setSelectedCategory(category);
    setIsEditing(false);
    onNotify(`${category.name} category selected`);
  };
  const startEditingCategory = (category: { name: string; pieces: number }) => {
    setSelectedCategory(category);
    setEditName(category.name);
    setIsEditing(true);
  };
  const saveCategoryEdit = async () => {
    if (!selectedCategory || !editName.trim()) return onNotify("Category name is required");
    const updatedCategory = { ...selectedCategory, name: editName.trim() };
    const remoteError = await renameCatalogCategory(selectedCategory.name, updatedCategory);
    setCategories((current) => current.map((category) => category.name === selectedCategory.name ? updatedCategory : category));
    persistCategories(categories.map((category) => category.name === selectedCategory.name ? updatedCategory : category));
    setSelectedCategory(updatedCategory);
    setIsEditing(false);
    onNotify(remoteError ? "Category saved locally; Supabase needs its tables" : `${updatedCategory.name} category updated`);
  };
  const deleteCategory = async (category: { name: string; pieces: number }) => {
    if (!window.confirm(`Delete ${category.name}?`)) return;
    const remoteError = await removeCatalogCategory(category.name);
    setCategories((current) => current.filter((item) => item.name !== category.name));
    persistCategories(categories.filter((item) => item.name !== category.name));
    if (selectedCategory?.name === category.name) setSelectedCategory(null);
    onNotify(remoteError ? "Category deleted locally; Supabase needs its tables" : `${category.name} category deleted`);
  };
  return <section className="panel module-workspace"><div className="module-workspace-head"><div><p className="eyebrow">CATALOG</p><h2>Categories</h2><p>Keep collections easy to browse with clear category structure.</p></div><div className="module-actions"><button className="module-secondary" onClick={() => onNotify("Category reorder mode opened")}>Reorder ↗</button><button className="module-primary" onClick={() => setIsAdding(true)}>+ Add category</button></div></div>{isAdding && <div className="product-modal-backdrop" onClick={() => setIsAdding(false)}><div className="product-form-card product-modal-card category-modal-card" role="dialog" aria-modal="true" aria-labelledby="add-category-title" onClick={(event) => event.stopPropagation()}><button className="product-modal-close" aria-label="Close add category form" onClick={() => setIsAdding(false)}>×</button><p className="eyebrow">NEW CATEGORY</p><h3 id="add-category-title">Add a category</h3><div className="product-form-grid category-form-grid"><label>Category name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Anklets" /></label></div><div className="product-detail-actions"><button className="module-primary" onClick={saveCategory}>Save category</button><button className="module-secondary" onClick={() => setIsAdding(false)}>Cancel</button></div></div></div>}<div className="module-summary"><span><i className="status-light" />Live workspace</span><span>{categories.length} active categories</span></div><div className="module-list">{categories.map((category, index) => <div key={`${category.name}-${index}`} className={`category-list-row ${selectedCategory?.name === category.name ? "selected" : ""}`}><button className="category-list-main" onClick={() => openCategory(category)}><span className="module-row-number">{String(index + 1).padStart(2, "0")}</span><strong>{category.name}</strong><small>{category.pieces} pieces</small><b>↗</b></button><div className="product-row-actions"><button onClick={() => openCategory(category)} aria-label={`View ${category.name}`} title="View category"><Eye size={15} strokeWidth={1.8} aria-hidden="true" /></button><button onClick={() => startEditingCategory(category)} aria-label={`Edit ${category.name}`} title="Edit category"><Pencil size={15} strokeWidth={1.8} aria-hidden="true" /></button><button className="delete-action" onClick={() => deleteCategory(category)} aria-label={`Delete ${category.name}`} title="Delete category"><Trash2 size={15} strokeWidth={1.8} aria-hidden="true" /></button></div></div>)}</div>{selectedCategory && isEditing && <div className="product-form-card category-edit-card"><p className="eyebrow">EDIT CATEGORY</p><h3>Edit {selectedCategory.name}</h3><div className="product-form-grid category-form-grid"><label>Category name<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label></div><div className="product-detail-actions"><button className="module-primary" onClick={saveCategoryEdit}>Save changes</button><button className="module-secondary" onClick={() => setIsEditing(false)}>Cancel</button></div></div>}{selectedCategory && !isEditing && <div className="product-detail-card category-detail-card"><div className="product-detail-copy"><p className="eyebrow">CATEGORY DETAILS</p><h3>{selectedCategory.name}</h3><p className="product-detail-meta">Jewellery category</p><div className="product-detail-actions"><button className="module-primary" onClick={() => startEditingCategory(selectedCategory)}>Edit category</button><button className="module-secondary" onClick={() => setSelectedCategory(null)}>Close</button></div></div></div>}</section>;
}

function ProductLibraryWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [products, setProducts] = useState(adminProducts);
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({ name: "", category: "", price: "", stock: "", sku: "" });
  const [newProductImage, setNewProductImage] = useState(adminProducts[0].image);
  const [newProductFile, setNewProductFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newProduct, setNewProduct] = useState({ name: "", category: "Earrings", price: "₹", stock: "", sku: "" });
  useEffect(() => {
    let active = true;
    const loadProducts = async () => {
      const remote = await fetchCatalogProducts();
      if (active && !remote.error && remote.data && remote.data.length) {
        const mapped = remote.data.map((product) => ({
          name: product.name,
          price: `₹${product.price.toLocaleString("en-IN")}`,
          sku: product.sku,
          category: product.category,
          stock: product.stock,
          status: product.status,
          image: product.image || adminProducts[0].image,
        }));
        setProducts(mapped);
        persistCatalog(mapped);
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-products");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Array<Partial<AdminProduct> & { id?: string; price?: number | string }>;
        if (active && Array.isArray(parsed) && parsed.length) {
          setProducts(parsed.filter((product) => typeof product.name === "string" && product.name.trim()).map((product, index) => ({
            name: product.name!.trim(),
            price: typeof product.price === "number" ? `₹${product.price.toLocaleString("en-IN")}` : product.price || "₹0",
            sku: product.sku || product.id?.toUpperCase() || `FZ-IMP-${String(index + 1).padStart(2, "0")}`,
            category: product.category || "Uncategorised",
            stock: product.stock ?? 0,
            status: product.status ?? "Published",
            image: product.image || adminProducts[0].image,
          })));
        }
      } catch {
        window.localStorage.removeItem("fanzzy-products");
      }
    };
    void loadProducts();
    return () => { active = false; };
  }, []);
  const updateField = (field: keyof typeof newProduct, value: string) => setNewProduct((current) => ({ ...current, [field]: value, ...(field === "name" ? { sku: createSku(value, current.category, products) } : {}) }));
  const openAddProduct = () => {
    setNewProduct({ name: "", category: "Earrings", price: "₹", stock: "", sku: "" });
    setNewProductImage(adminProducts[0].image);
    setNewProductFile(null);
    setSelectedProduct(null);
    setIsEditing(false);
    setIsAdding(true);
  };
  const saveProduct = async () => {
    if (!newProduct.name.trim()) return onNotify("Add a product name");
    const productSku = newProduct.sku.trim() || createSku(newProduct.name, newProduct.category, products);
    let productImage = newProductImage;
    let imageSavedLocally = false;
    if (newProductFile) {
      try { productImage = await makeLocalImage(newProductFile); } catch { /* keep the preview */ }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(newProductFile, "products");
        if (upload.error || !upload.url) {
          // Keep the compact preview and finish saving locally when storage is unavailable.
          imageSavedLocally = true;
        } else {
          productImage = upload.url;
        }
      }
    }
    const product: AdminProduct = { name: newProduct.name.trim(), sku: productSku, category: newProduct.category, stock: Number(newProduct.stock) || 0, price: newProduct.price.trim() || "₹0", status: Number(newProduct.stock) > 0 ? "Published" : "Draft", image: productImage };
    const remoteError = await saveCatalogProduct(toCatalogProduct(product));
    setProducts((current) => { const next = [...current, product]; persistCatalog(next); return next; });
    setNewProduct({ name: "", category: "Earrings", price: "₹", stock: "", sku: "" });
    setNewProductImage(adminProducts[0].image);
    setNewProductFile(null);
    setIsAdding(false);
    onNotify(remoteError ? imageSavedLocally ? "Product and image saved locally; Supabase needs setup" : "Product saved locally; Supabase needs its tables" : imageSavedLocally ? "Product added; image saved locally until storage is connected" : `${product.name} added to the catalog`);
  };
  const uploadProductImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNewProductFile(file);
    void makeLocalImage(file).then(setNewProductImage).catch(() => {
      const reader = new FileReader();
      reader.onload = () => setNewProductImage(String(reader.result));
      reader.readAsDataURL(file);
    });
  };
  const startEditing = (product: AdminProduct) => {
    setSelectedProduct(product);
    setIsAdding(false);
    setIsEditing(true);
    setEditValues({ name: product.name, category: product.category, price: product.price, stock: String(product.stock), sku: product.sku });
  };
  const saveEdit = async () => {
    if (!selectedProduct || !editValues.name.trim()) return onNotify("Product name is required");
    const updated: AdminProduct = { ...selectedProduct, name: editValues.name.trim(), category: editValues.category, price: editValues.price.trim() || "₹0", stock: Number(editValues.stock) || 0, sku: editValues.sku.trim() || selectedProduct.sku, status: Number(editValues.stock) > 0 ? "Published" : "Draft" };
    const remoteError = await saveCatalogProduct(toCatalogProduct(updated));
    if (!remoteError && updated.sku !== selectedProduct.sku) await removeCatalogProduct(selectedProduct.sku);
    setProducts((current) => { const next = current.map((product) => product.sku === selectedProduct.sku ? updated : product); persistCatalog(next); return next; });
    setSelectedProduct(updated);
    setIsEditing(false);
    onNotify(remoteError ? "Product saved locally; Supabase needs its tables" : `${updated.name} updated`);
  };
  const deleteProduct = async (product: AdminProduct) => {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    const remoteError = await removeCatalogProduct(product.sku);
    setProducts((current) => { const next = current.filter((item) => item.sku !== product.sku); persistCatalog(next); return next; });
    if (selectedProduct?.sku === product.sku) setSelectedProduct(null);
    setIsEditing(false);
    onNotify(remoteError ? "Product deleted locally; Supabase needs its tables" : `${product.name} deleted`);
  };
  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
    const findColumn = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
    const nameColumn = findColumn(["name", "product", "product name", "title"]);
    const skuColumn = findColumn(["sku", "product sku", "code"]);
    const categoryColumn = findColumn(["category", "type"]);
    const priceColumn = findColumn(["price", "amount"]);
    const stockColumn = findColumn(["stock", "inventory", "quantity", "qty"]);
    const imported = rows.map((row, index): AdminProduct | null => {
      const name = nameColumn >= 0 ? row[nameColumn]?.trim() : "";
      if (!name) return null;
      const stock = Number.parseInt(stockColumn >= 0 ? row[stockColumn] ?? "0" : "0", 10) || 0;
      return { name, sku: skuColumn >= 0 && row[skuColumn]?.trim() ? row[skuColumn].trim() : `FZ-IMP-${String(index + 1).padStart(2, "0")}`, category: categoryColumn >= 0 && row[categoryColumn]?.trim() ? row[categoryColumn].trim() : "Uncategorised", price: priceColumn >= 0 && row[priceColumn]?.trim() ? row[priceColumn].trim() : "₹0", stock, status: stock > 0 ? "Published" : "Draft", image: adminProducts[0].image };
    }).filter((product): product is AdminProduct => product !== null);
    if (!imported.length) onNotify("No valid product rows found in CSV");
    else {
      const remoteErrors = await Promise.all(imported.map((product) => saveCatalogProduct(toCatalogProduct(product))));
      setProducts((current) => { const next = [...current, ...imported]; persistCatalog(next); return next; });
      onNotify(remoteErrors.some(Boolean) ? "Imported locally; Supabase needs its tables" : `${imported.length} product${imported.length === 1 ? "" : "s"} imported`);
    }
    event.target.value = "";
  };
  return <section className="panel module-workspace"><div className="module-workspace-head"><div><p className="eyebrow">CATALOG</p><h2>Product library</h2><p>Create, edit, price, and organise every piece in your storefront.</p></div><div className="module-actions"><input ref={fileInputRef} className="csv-file-input" type="file" accept=".csv,text/csv" onChange={importCsv} /><button className="module-secondary" onClick={() => fileInputRef.current?.click()}>Import CSV ↗</button><button className="module-primary" onClick={openAddProduct}>+ Add product</button></div></div>{isAdding && <div className="product-modal-backdrop" onClick={() => setIsAdding(false)}><div className="product-form-card product-modal-card" role="dialog" aria-modal="true" aria-labelledby="add-product-title" onClick={(event) => event.stopPropagation()}><button className="product-modal-close" aria-label="Close add product form" onClick={() => setIsAdding(false)}>×</button><p className="eyebrow">NEW PRODUCT</p><h3 id="add-product-title">Add a product</h3><div className="product-image-upload"><img src={newProductImage} alt="Product preview" /><label><strong>Upload product image</strong><small>JPG, PNG or WEBP · click to choose</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProductImage} /></label></div><div className="product-form-grid"><label>Product name<input value={newProduct.name} onChange={(event) => updateField("name", event.target.value)} placeholder="e.g. Celeste Hoops" /></label><label>SKU<input value={newProduct.sku} onChange={(event) => updateField("sku", event.target.value)} placeholder="FZ-CEL-05" /></label><label>Category<select value={newProduct.category} onChange={(event) => updateField("category", event.target.value)}><option>Earrings</option><option>Necklaces</option><option>Bracelets</option><option>Rings</option></select></label><label>Price<input value={newProduct.price} onChange={(event) => updateField("price", event.target.value)} /></label><label>Stock<input type="number" min="0" value={newProduct.stock} onChange={(event) => updateField("stock", event.target.value)} placeholder="0" /></label></div><div className="product-detail-actions"><button className="module-primary" onClick={saveProduct}>Save product</button><button className="module-secondary" onClick={() => setIsAdding(false)}>Cancel</button></div></div></div>}<div className="module-summary"><span><i className="status-light" />Live workspace</span><span>{products.length} active records</span></div><div className="module-list">{products.map((product, index) => <div key={product.sku} className={`product-list-row ${selectedProduct?.sku === product.sku ? "selected" : ""}`}><button className="product-list-main" onClick={() => { setSelectedProduct(product); setIsAdding(false); setIsEditing(false); onNotify(`${product.name} opened`); }}><span className="module-row-number">{String(index + 1).padStart(2, "0")}</span><strong>{product.name}</strong><small>{product.stock === 0 ? "Draft" : `${product.stock} in stock`} · {product.category}</small></button><div className="product-row-actions"><button onClick={() => { setSelectedProduct(product); setIsAdding(false); setIsEditing(false); onNotify(`${product.name} opened`); }} aria-label={`View ${product.name}`} title="View product"><Eye size={15} strokeWidth={1.8} aria-hidden="true" /></button><button onClick={() => startEditing(product)} aria-label={`Edit ${product.name}`} title="Edit product"><Pencil size={15} strokeWidth={1.8} aria-hidden="true" /></button><button className="delete-action" onClick={() => deleteProduct(product)} aria-label={`Delete ${product.name}`} title="Delete product"><Trash2 size={15} strokeWidth={1.8} aria-hidden="true" /></button></div></div>)}</div>{selectedProduct && isEditing && <div className="product-form-card"><p className="eyebrow">EDIT PRODUCT</p><h3>Edit {selectedProduct.name}</h3><div className="product-form-grid"><label>Product name<input value={editValues.name} onChange={(event) => setEditValues((current) => ({ ...current, name: event.target.value }))} /></label><label>SKU<input value={editValues.sku} onChange={(event) => setEditValues((current) => ({ ...current, sku: event.target.value }))} /></label><label>Category<select value={editValues.category} onChange={(event) => setEditValues((current) => ({ ...current, category: event.target.value }))}><option>Earrings</option><option>Necklaces</option><option>Bracelets</option><option>Rings</option></select></label><label>Price<input value={editValues.price} onChange={(event) => setEditValues((current) => ({ ...current, price: event.target.value }))} /></label><label>Stock<input type="number" min="0" value={editValues.stock} onChange={(event) => setEditValues((current) => ({ ...current, stock: event.target.value }))} /></label></div><div className="product-detail-actions"><button className="module-primary" onClick={saveEdit}>Save changes</button><button className="module-secondary" onClick={() => setIsEditing(false)}>Cancel</button></div></div>}{selectedProduct && !isEditing && <div className="product-detail-card"><div className="product-detail-image"><img src={selectedProduct.image} alt="" /></div><div className="product-detail-copy"><p className="eyebrow">PRODUCT DETAILS</p><h3>{selectedProduct.name}</h3><p className="product-detail-meta">{selectedProduct.category} · {selectedProduct.sku}</p><div className="product-detail-stats"><span><small>Price</small><strong>{selectedProduct.price}</strong></span><span><small>Inventory</small><strong>{selectedProduct.stock === 0 ? "Draft" : `${selectedProduct.stock} units`}</strong></span><span><small>Status</small><strong>{selectedProduct.status}</strong></span></div><div className="product-detail-actions"><button className="module-primary" onClick={() => startEditing(selectedProduct)}>Edit product</button><button className="module-secondary" onClick={() => setSelectedProduct(null)}>Close</button></div></div></div>}</section>;
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (inQuotes && csv[index + 1] === '"') { value += '"'; index += 1; }
      else inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !inQuotes) { if (character === "\r" && csv[index + 1] === "\n") index += 1; row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}





