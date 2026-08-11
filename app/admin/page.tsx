"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import {
  fetchCatalogCategories,
  fetchCatalogProducts,
  fetchStoreSetting,
  isSupabaseReady,
  removeCatalogCategory,
  removeCatalogProduct,
  renameCatalogCategory,
  saveCatalogCategory,
  saveCatalogProduct,
  saveStoreSetting,
  uploadStoreImage,
} from "../../lib/supabase/catalog";
import "../globals.css";
import "../brand-polish.css";
import "./admin.css";
import "./admin-polish.css";

type AdminProduct = {
  name: string;
  sku: string;
  category: string;
  stock: number;
  price: string;
  cost: string;
  status: "Published" | "Draft" | "Low stock";
  image: string;
  hoverImage?: string;
};
type MarketingKind = "Campaign" | "Coupon" | "Newsletter";
type MarketingStatus = "Active" | "Scheduled" | "Draft";
type MarketingRecord = {
  id: string;
  kind: MarketingKind;
  name: string;
  detail: string;
  status: MarketingStatus;
  code?: string;
  discount?: string;
};
type DateRange = "this-month" | "last-month" | "all-time";
type ProductFilter = "all" | "low-stock" | "drafts";
type OrderDateFilter =
  | "today"
  | "this-week"
  | "this-month"
  | "all-time"
  | "custom";
type AdminPermission =
  | "Overview"
  | "Products"
  | "Categories"
  | "Collections"
  | "Orders"
  | "Customers"
  | "Marketing"
  | "Homepage"
  | "Delivery charge"
  | "Settings";
type AdminRole = {
  id: string;
  name: string;
  title: string;
  permissions: AdminPermission[];
};
const allAdminPermissions: AdminPermission[] = [
  "Overview",
  "Products",
  "Categories",
  "Collections",
  "Orders",
  "Customers",
  "Marketing",
  "Homepage",
  "Delivery charge",
  "Settings",
];
const defaultAdminRoles: AdminRole[] = [
  { id: "vestano", name: "Vestano", title: "Super admin", permissions: allAdminPermissions },
  { id: "store-manager", name: "Store manager", title: "Operations", permissions: ["Overview", "Products", "Categories", "Collections", "Orders", "Customers", "Homepage", "Delivery charge"] },
  { id: "fulfilment", name: "Fulfilment", title: "Orders & delivery", permissions: ["Overview", "Orders", "Customers", "Delivery charge"] },
  { id: "marketing", name: "Marketing", title: "Content & growth", permissions: ["Overview", "Collections", "Marketing", "Homepage"] },
];

const adminProducts: AdminProduct[] = [
  {
    name: "Aurora Drop Earrings",
    sku: "LST-AUR-01",
    category: "Earrings",
    stock: 24,
    price: "₹1,290",
    cost: "₹645",
    status: "Published",
    image:
      "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=200&q=80",
  },
  {
    name: "Solstice Tennis Necklace",
    sku: "LST-SOL-02",
    category: "Necklaces",
    stock: 8,
    price: "₹2,480",
    cost: "₹1,240",
    status: "Low stock",
    image:
      "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=200&q=80",
  },
  {
    name: "Muse Sculpted Cuff",
    sku: "LST-MUS-03",
    category: "Bracelets",
    stock: 0,
    price: "₹1,860",
    cost: "₹930",
    status: "Draft",
    image:
      "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=200&q=80",
  },
  {
    name: "Orbital Pearl Ring",
    sku: "LST-ORB-04",
    category: "Rings",
    stock: 41,
    price: "₹990",
    cost: "₹495",
    status: "Published",
    image:
      "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=80",
  },
];
const defaultHeroImage =
  "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=90";
const defaultCategoryImages: Record<string, string> = {
  Earrings:
    "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=700&q=85",
  Necklaces:
    "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=700&q=85",
  Bracelets:
    "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=700&q=85",
  Rings:
    "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=700&q=85",
};
const defaultHeroSlides = [
  defaultHeroImage,
  "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1800&q=90",
  "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1800&q=90",
  "https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=1800&q=90",
];
const defaultHeroSlideDuration = 5.2;
const defaultDeliveryCharge = { enabled: false, amount: 99 };
const defaultMarketingRecords: MarketingRecord[] = [
  {
    id: "august-welcome",
    kind: "Campaign",
    name: "August welcome offer",
    detail: "First-order welcome promotion",
    status: "Active",
    discount: "10% off",
  },
  {
    id: "hello-fanzzy",
    kind: "Coupon",
    name: "HELLOFANZZY",
    detail: "First order discount",
    status: "Active",
    code: "HELLOFANZZY",
    discount: "10% off",
  },
  {
    id: "weekend-edit",
    kind: "Campaign",
    name: "Weekend edit",
    detail: "Scheduled collection promotion",
    status: "Scheduled",
  },
  {
    id: "newsletter",
    kind: "Newsletter",
    name: "Newsletter",
    detail: "Subscribers receiving Fanzzy updates",
    status: "Active",
    discount: "1,284 subscribers",
  },
];
type OrderStatus =
  | "Processing"
  | "Packed"
  | "Shipped"
  | "Delivered"
  | "Cancelled";
type OrderRecord = {
  id: string;
  date: string;
  status: OrderStatus;
  total: string;
  customerName: string;
  phone: string;
};
const adminOrders: OrderRecord[] = [
  {
    id: "#FZ-1048",
    date: "2026-08-08",
    status: "Processing",
    total: "₹4,860",
    customerName: "Customer 1048",
    phone: "",
  },
  {
    id: "#FZ-1047",
    date: "2026-08-07",
    status: "Packed",
    total: "₹2,480",
    customerName: "Customer 1047",
    phone: "",
  },
  {
    id: "#FZ-1046",
    date: "2026-08-03",
    status: "Shipped",
    total: "₹1,290",
    customerName: "Customer 1046",
    phone: "",
  },
  {
    id: "#FZ-1045",
    date: "2026-07-28",
    status: "Delivered",
    total: "₹3,120",
    customerName: "Customer 1045",
    phone: "",
  },
  {
    id: "#FZ-1044",
    date: "2026-07-14",
    status: "Delivered",
    total: "₹1,860",
    customerName: "Customer 1044",
    phone: "",
  },
];
const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteAsset = (name: string) => `${siteBasePath}/${name}`;
const createSku = (
  name: string,
  category: string,
  existing: AdminProduct[],
) => {
  const prefix = (
    name.replace(/[^a-zA-Z0-9]/g, "") ||
    category.replace(/[^a-zA-Z0-9]/g, "") ||
    "ITEM"
  )
    .toUpperCase()
    .slice(0, 4);
  let number = existing.length + 1;
  let sku = `FZ-${prefix}-${String(number).padStart(3, "0")}`;
  while (existing.some((product) => product.sku === sku)) {
    number += 1;
    sku = `FZ-${prefix}-${String(number).padStart(3, "0")}`;
  }
  return sku;
};
const makeLocalImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image"));
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error("Could not process image"));
      image.onload = () => {
        const maxSize = 1000;
        const scale = Math.min(
          1,
          maxSize / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas
          .getContext("2d")
          ?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", 0.72));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
const persistCatalog = (catalog: AdminProduct[]) => {
  if (typeof window === "undefined") return;
  const tones = ["#d9c4bc", "#dad7ce", "#d0c2b0", "#e5ddd1"];
  const storefrontCatalog = catalog.map((product, index) => ({
    id: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: product.name,
    sku: product.sku,
    category: product.category,
    stock: product.stock,
    status: product.status,
    price: Number(product.price.replace(/[^0-9]/g, "")) || 0,
    cost: Number(product.cost.replace(/[^0-9]/g, "")) || 0,
    image: product.image,
    hoverImage: product.hoverImage || product.image,
    tag: product.status === "Draft" ? "Draft" : undefined,
    tone: tones[index % tones.length],
  }));
  try {
    window.localStorage.setItem(
      "fanzzy-products",
      JSON.stringify(storefrontCatalog),
    );
  } catch {
    // A large data URL must never crash the admin page when local storage is full.
    const compactCatalog = storefrontCatalog.map((product) =>
      product.image.startsWith("data:") ||
      product.hoverImage.startsWith("data:")
        ? {
            ...product,
            image: product.image.startsWith("data:") ? "" : product.image,
            hoverImage: product.hoverImage.startsWith("data:")
              ? ""
              : product.hoverImage,
          }
        : product,
    );
    try {
      window.localStorage.setItem(
        "fanzzy-products",
        JSON.stringify(compactCatalog),
      );
    } catch {
      try {
        window.localStorage.removeItem("fanzzy-products");
      } catch {
        /* storage is unavailable */
      }
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
  cost: Number(product.cost.replace(/[^0-9.]/g, "")) || 0,
  status: product.status,
  image: product.image,
  hoverImage: product.hoverImage || product.image,
});
const persistCategories = (
  categories: Array<{ name: string; pieces: number; image?: string }>,
) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("fanzzy-categories", JSON.stringify(categories));
  window.dispatchEvent(new Event("fanzzy-categories-updated"));
};
const menu = [
  { label: "Overview", icon: "◌" },
  { label: "Products", icon: "◇", count: "24" },
  { label: "Categories", icon: "▦" },
  { label: "Collections", icon: "✧" },
  { label: "Orders", icon: "↗", count: "12" },
  { label: "Customers", icon: "♧" },
  { label: "Marketing", icon: "◈" },
  { label: "Homepage", icon: "⌂" },
  { label: "Delivery charge", icon: "₹" },
];

export default function AdminPage() {
  const [active, setActive] = useState("Overview");
  const [adminRoles, setAdminRoles] = useState<AdminRole[]>(defaultAdminRoles);
  const [activeRoleId, setActiveRoleId] = useState("vestano");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("this-month");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const categories = useMemo(
    () => [
      "All categories",
      ...Array.from(new Set(adminProducts.map((product) => product.category))),
    ],
    [],
  );
  const shownProducts = useMemo(
    () =>
      adminProducts.filter((product) => {
        const matchesQuery =
          `${product.name} ${product.sku} ${product.category}`
            .toLowerCase()
            .includes(query.toLowerCase());
        const matchesFilter =
          productFilter === "all" ||
          (productFilter === "low-stock" &&
            (product.stock < 10 || product.status === "Low stock")) ||
          (productFilter === "drafts" && product.status === "Draft");
        const matchesCategory =
          categoryFilter === "All categories" ||
          product.category === categoryFilter;
        return matchesQuery && matchesFilter && matchesCategory;
      }),
    [categoryFilter, productFilter, query],
  );
  const activeRole = adminRoles.find((role) => role.id === activeRoleId) ?? defaultAdminRoles[0];
  const canAccess = (section: string) => activeRole.permissions.includes(section as AdminPermission);
  const visibleMenu = menu.filter((item) => canAccess(item.label));

  useEffect(() => {
    const syncRoles = () => {
      const storedRoles = window.localStorage.getItem("fanzzy-admin-roles");
      if (storedRoles) {
        try {
          const parsed = JSON.parse(storedRoles) as AdminRole[];
          if (Array.isArray(parsed) && parsed.length && parsed.every((role) => role?.id && Array.isArray(role.permissions))) setAdminRoles(parsed);
        } catch {
          window.localStorage.removeItem("fanzzy-admin-roles");
        }
      }
      const storedRole = window.localStorage.getItem("fanzzy-active-admin-role");
      if (storedRole) setActiveRoleId(storedRole);
    };
    syncRoles();
    window.addEventListener("fanzzy-store-settings-updated", syncRoles);
    return () => window.removeEventListener("fanzzy-store-settings-updated", syncRoles);
  }, []);

  useEffect(() => {
    if (!canAccess(active)) setActive(canAccess("Overview") ? "Overview" : (visibleMenu[0]?.label ?? "Overview"));
    // The role controls the visible workspace; this keeps a previously selected page from leaking across roles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoleId, adminRoles]);

  const switchRole = (roleId: string) => {
    const nextRole = adminRoles.find((role) => role.id === roleId) ?? defaultAdminRoles[0];
    setActiveRoleId(nextRole.id);
    window.localStorage.setItem("fanzzy-active-admin-role", nextRole.id);
    setActive(nextRole.permissions.includes("Overview") ? "Overview" : nextRole.permissions[0]);
    setToast(`Viewing as ${nextRole.name} · ${nextRole.title}`);
    window.setTimeout(() => setToast(""), 2200);
  };
  const metrics = {
    "this-month": {
      revenue: "₹2,48,620",
      orders: "184",
      average: "₹1,351",
      customers: "78",
      growth: ["+18.4%", "+12.8%", "+6.2%", "+24.1%"],
    },
    "last-month": {
      revenue: "₹2,09,980",
      orders: "163",
      average: "₹1,286",
      customers: "63",
      growth: ["+9.6%", "+8.1%", "+4.8%", "+18.2%"],
    },
    "all-time": {
      revenue: "₹8,42,560",
      orders: "612",
      average: "₹1,377",
      customers: "246",
      growth: ["+21.7%", "+16.4%", "+7.1%", "+28.6%"],
    },
  }[dateRange];
  const dateLabels: Record<DateRange, string> = {
    "this-month": "This month",
    "last-month": "Last month",
    "all-time": "All time",
  };
  const notify = (message: string) => {
    if (message === "Preview opened") {
      window.location.assign(`${siteBasePath}/`);
      return;
    }
    if (message === "New product form opened" || message.endsWith(" selected"))
      setActive("Products");
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <a href={`${siteBasePath}/`} className="wordmark">
            <img
              src={siteAsset("fanzzy-mark.png")}
              alt="Fanzzy"
              className="brand-logo"
            />
            <small>control room</small>
          </a>
          <span className="live-dot">LIVE</span>
        </div>
        <div className="admin-profile">
          <div className="avatar">{activeRole.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{activeRole.name}</strong>
            <small>{activeRole.title}</small>
          </div>
          <select className="role-switcher" aria-label="Switch admin role" value={activeRole.id} onChange={(event) => switchRole(event.target.value)}>
            {adminRoles.map((role) => <option value={role.id} key={role.id}>{role.name} · {role.title}</option>)}
          </select>
        </div>
        <p className="admin-label">Workspace</p>
        <nav className="admin-nav">
          {visibleMenu.map((item) => (
            <button
              key={item.label}
              className={active === item.label ? "active" : ""}
              onClick={() => setActive(item.label)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.count && <b>{item.count}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => canAccess("Settings") ? setActive("Settings") : notify(`${activeRole.title} cannot access Settings`)}>
            <span className="nav-icon">⚙</span>Settings
          </button>
          <a href={`${siteBasePath}/`}>
            <span className="nav-icon">↩</span>View storefront
          </a>
        </div>
      </aside>
      <section
        className={`admin-content ${active !== "Overview" ? "module-active" : ""}`}
      >
        <header className="admin-topbar">
          <div className="admin-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search orders, products, customers…"
            />
          </div>
          <div className="admin-top-actions">
            <button onClick={() => notify("No new notifications")}>
              ♢<i />
            </button>
            <button onClick={() => notify("Preview opened")}>
              Preview store ↗
            </button>
            <div className="mini-avatar">VE</div>
          </div>
        </header>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Saturday, 08 August 2026</p>
            <h1>
              Good morning, Vestano <span>✦</span>
            </h1>
            <p className="subcopy">
              Here’s what’s happening across Fanzzy today.
            </p>
          </div>
          <label className="date-control">
            {" "}
            <span>{dateLabels[dateRange]}</span>
            <select
              aria-label="Dashboard date range"
              value={dateRange}
              onChange={(event) =>
                setDateRange(event.target.value as DateRange)
              }
            >
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="all-time">All time</option>
            </select>
          </label>
        </div>
        <AnnouncementPanel onNotify={notify} />
        {active !== "Overview" && (
          <ModuleWorkspace module={active} onNotify={notify} />
        )}
        <div className="stats-grid">
          <Stat
            label="Revenue"
            value={metrics.revenue}
            change={metrics.growth[0]}
            note={
              dateRange === "this-month" ? "vs. last month" : "selected period"
            }
          />
          <Stat
            label="Orders"
            value={metrics.orders}
            change={metrics.growth[1]}
            note={
              dateRange === "this-month" ? "vs. last month" : "selected period"
            }
          />
          <Stat
            label="Average order"
            value={metrics.average}
            change={metrics.growth[2]}
            note={
              dateRange === "this-month" ? "vs. last month" : "selected period"
            }
          />
          <Stat
            label="New customers"
            value={metrics.customers}
            change={metrics.growth[3]}
            note={
              dateRange === "this-month" ? "vs. last month" : "selected period"
            }
          />
        </div>
        <div className="dashboard-grid">
          <section className="panel sales-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">REVENUE OVERVIEW</p>
                <h2>Sales performance</h2>
              </div>
              <div className="chart-legend">
                <span>
                  <i className="dot wine-dot" />
                  {dateLabels[dateRange]}
                </span>
                <span>
                  <i className="dot gold-dot" />
                  Previous period
                </span>
              </div>
            </div>
            <div className="chart-value">
              {metrics.revenue} <span>↑ {metrics.growth[0].slice(1)}</span>
            </div>
            <div className="sales-chart">
              <div className="chart-y">
                <span>₹3L</span>
                <span>₹2L</span>
                <span>₹1L</span>
                <span>₹0</span>
              </div>
              <div className="chart-area">
                <div className="grid-lines">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <svg
                  viewBox="0 0 640 190"
                  preserveAspectRatio="none"
                  aria-label="Revenue trend chart"
                >
                  <path
                    d="M0,152 C50,130 57,150 97,127 S147,119 188,136 S241,74 283,93 S338,109 370,88 S430,57 464,76 S519,79 552,40 S605,62 640,24"
                    fill="none"
                    stroke="#4b1c2b"
                    strokeWidth="3"
                  />
                  <path
                    d="M0,165 C52,144 75,158 100,151 S145,139 188,148 S241,116 283,128 S332,130 370,119 S430,104 464,120 S519,112 552,91 S605,101 640,73"
                    fill="none"
                    stroke="#c9a875"
                    strokeWidth="2"
                    strokeDasharray="5 5"
                  />
                </svg>
                <div className="chart-x">
                  <span>01 Aug</span>
                  <span>07 Aug</span>
                  <span>14 Aug</span>
                  <span>21 Aug</span>
                  <span>28 Aug</span>
                </div>
              </div>
            </div>
          </section>
          <section className="panel order-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LIVE PULSE</p>
                <h2>Order status</h2>
              </div>
              <button
                className="panel-link"
                onClick={() => setActive("Orders")}
              >
                View all ↗
              </button>
            </div>
            <div className="order-ring">
              <div>
                <strong>{metrics.orders}</strong>
                <span>Total orders</span>
              </div>
            </div>
            <div className="status-list">
              <Status
                color="wine"
                label="Delivered"
                value={
                  dateRange === "this-month"
                    ? "108"
                    : dateRange === "last-month"
                      ? "94"
                      : "365"
                }
              />
              <Status
                color="gold"
                label="Processing"
                value={
                  dateRange === "this-month"
                    ? "34"
                    : dateRange === "last-month"
                      ? "29"
                      : "117"
                }
              />
              <Status
                color="peach"
                label="Shipped"
                value={
                  dateRange === "this-month"
                    ? "28"
                    : dateRange === "last-month"
                      ? "25"
                      : "86"
                }
              />
              <Status
                color="lavender"
                label="Pending"
                value={
                  dateRange === "this-month"
                    ? "14"
                    : dateRange === "last-month"
                      ? "15"
                      : "44"
                }
              />
            </div>
          </section>
        </div>
        <div className="lower-grid">
          <section className="panel products-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CATALOG HEALTH</p>
                <h2>Product pulse</h2>
              </div>
              <button
                className="panel-link"
                onClick={() => setActive("Products")}
              >
                Manage catalog ↗
              </button>
            </div>
            <div className="table-tools">
              <div className="table-filters">
                <div className="table-tabs">
                  <button
                    className={productFilter === "all" ? "active" : ""}
                    onClick={() => setProductFilter("all")}
                  >
                    All products <b>24</b>
                  </button>
                  <button
                    className={productFilter === "low-stock" ? "active" : ""}
                    onClick={() => setProductFilter("low-stock")}
                  >
                    Low stock <b>03</b>
                  </button>
                  <button
                    className={productFilter === "drafts" ? "active" : ""}
                    onClick={() => setProductFilter("drafts")}
                  >
                    Drafts <b>02</b>
                  </button>
                </div>
                <select
                  className="category-filter"
                  aria-label="Filter products by category"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </div>
              <button
                className="add-product"
                onClick={() => notify("New product form opened")}
              >
                + Add product
              </button>
            </div>
            <div className="product-table">
              <div className="table-row table-header">
                <span>Product</span>
                <span>Category</span>
                <span>Inventory</span>
                <span>Price</span>
                <span>Status</span>
                <span />
              </div>
              {shownProducts.map((product) => (
                <div className="table-row" key={product.sku}>
                  <div className="table-product">
                    <img src={product.image} alt="" />
                    <span>
                      <strong>{product.name}</strong>
                      <small>{product.sku}</small>
                    </span>
                  </div>
                  <span>{product.category}</span>
                  <span className={product.stock < 10 ? "low-stock" : ""}>
                    {product.stock === 0
                      ? "Out of stock"
                      : `${product.stock} in stock`}
                  </span>
                  <span>{product.price}</span>
                  <span>
                    <i
                      className={`status-pill ${product.status.toLowerCase().replace(" ", "-")}`}
                    >
                      {product.status}
                    </i>
                  </span>
                  <button
                    className="row-more"
                    onClick={() => notify(`${product.name} selected`)}
                  >
                    •••
                  </button>
                </div>
              ))}
            </div>
            {shownProducts.length === 0 && (
              <p className="empty-filter">No products match these filters.</p>
            )}
          </section>
          <section className="panel todo-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ATTENTION NEEDED</p>
                <h2>Your to-do list</h2>
              </div>
              <span className="task-count">4</span>
            </div>
            <Task
              label="Review 3 low stock products"
              tone="wine"
              onClick={() => {
                setProductFilter("low-stock");
                setCategoryFilter("All categories");
              }}
            />
            <Task
              label="Pack today’s 12 orders"
              tone="gold"
              onClick={() => setActive("Orders")}
            />
            <Task
              label="Approve 5 customer reviews"
              tone="lavender"
              onClick={() => notify("Reviews opened")}
            />
            <Task
              label="Schedule August campaign"
              tone="peach"
              onClick={() => setActive("Marketing")}
            />
            <div className="campaign-card">
              <span>✦</span>
              <div>
                <strong>Midnight Edit</strong>
                <small>Campaign is live · 4 days left</small>
              </div>
              <button onClick={() => setActive("Marketing")}>↗</button>
            </div>
          </section>
        </div>
        <div className="admin-footer">
          <span>Fanzzy control room · v1.0</span>
          <span>
            All systems operational <i className="status-light" />
          </span>
        </div>
      </section>
      {toast && (
        <div className="admin-toast">
          {toast} <span>✦</span>
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  change,
  note,
}: {
  label: string;
  value: string;
  change: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      <div>
        <span className="stat-change">↑ {change}</span>
        <small>{note}</small>
      </div>
    </div>
  );
}
function Status({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="status-item">
      <span>
        <i className={`dot ${color}-dot`} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
function Task({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className="task-row" onClick={onClick}>
      <span className={`task-check ${tone}`} />
      {label}
      <span className="task-arrow">↗</span>
    </button>
  );
}

function AnnouncementPanel({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [text, setText] = useState(
    "Complimentary shipping on orders above ₹999",
  );

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
    return () => {
      active = false;
    };
  }, []);

  const saveAnnouncement = async () => {
    const nextText = text.trim();
    const remoteError = await saveStoreSetting("announcement", nextText);
    window.localStorage.setItem("fanzzy-announcement", nextText);
    window.dispatchEvent(new Event("fanzzy-announcement-updated"));
    onNotify(
      remoteError
        ? "Saved locally; Supabase needs its tables"
        : "Announcement updated on storefront",
    );
  };

  return (
    <section className="panel announcement-panel">
      <div>
        <p className="eyebrow">STOREFRONT CONTENT</p>
        <h2>Announcement bar</h2>
        <p className="announcement-panel-copy">
          Edit the message shown above the Fanzzy header. Changes are saved to
          the shared storefront settings.
        </p>
      </div>
      <div className="announcement-editor">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Announcement bar text"
        />
        <button className="announcement-save" onClick={saveAnnouncement}>
          Save message
        </button>
      </div>
    </section>
  );
}

const moduleContent: Record<
  string,
  {
    eyebrow: string;
    title: string;
    description: string;
    primary: string;
    secondary: string;
    rows: string[];
  }
> = {
  Products: {
    eyebrow: "CATALOG",
    title: "Product library",
    description:
      "Create, edit, price, and organise every piece in your storefront.",
    primary: "Add product",
    secondary: "Import CSV",
    rows: [
      "Aurora Drop Earrings · 24 in stock",
      "Solstice Tennis Necklace · 8 in stock",
      "Muse Sculpted Cuff · Draft",
      "Orbital Pearl Ring · 41 in stock",
    ],
  },
  Categories: {
    eyebrow: "CATALOG",
    title: "Categories",
    description:
      "Keep collections easy to browse with clear category structure.",
    primary: "Add category",
    secondary: "Reorder",
    rows: [
      "Earrings · 42 pieces",
      "Necklaces · 28 pieces",
      "Bracelets · 18 pieces",
      "Rings · 24 pieces",
    ],
  },
  Collections: {
    eyebrow: "MERCHANDISING",
    title: "Collections",
    description: "Shape the edits customers see across the Fanzzy storefront.",
    primary: "New collection",
    secondary: "Manage featured",
    rows: [
      "Everyday Gold · 12 products",
      "Occasion pieces · 18 products",
      "Gifting · 9 products",
    ],
  },
  Orders: {
    eyebrow: "OPERATIONS",
    title: "Orders",
    description:
      "Review new orders, update fulfilment, and keep customers informed.",
    primary: "View pending",
    secondary: "Export orders",
    rows: [
      "#FZ-1048 · Processing · ₹4,860",
      "#FZ-1047 · Packed · ₹2,480",
      "#FZ-1046 · Shipped · ₹1,290",
      "#FZ-1045 · Delivered · ₹3,120",
    ],
  },
  Customers: {
    eyebrow: "RELATIONSHIPS",
    title: "Customers",
    description: "Understand your community and support every order with care.",
    primary: "Add customer",
    secondary: "Export list",
    rows: [
      "Amrita Mehra · 12 orders · ₹28,400",
      "Riya Sharma · 8 orders · ₹14,820",
      "Nisha Kapoor · 5 orders · ₹9,610",
      "Aarav Menon · 3 orders · ₹4,980",
    ],
  },
  Marketing: {
    eyebrow: "GROWTH",
    title: "Marketing studio",
    description:
      "Manage campaigns, coupons, and the messages that bring customers back.",
    primary: "Create campaign",
    secondary: "New coupon",
    rows: [
      "August welcome offer · Active",
      "HELLOFANZZY · 10% off",
      "Weekend edit · Scheduled",
      "Newsletter · 1,284 subscribers",
    ],
  },
  Homepage: {
    eyebrow: "CONTENT",
    title: "Homepage builder",
    description:
      "Control the sections, banners, and featured products on the storefront.",
    primary: "Add section",
    secondary: "Preview homepage",
    rows: [
      "Hero banner · Enabled",
      "Shop by mood · Enabled",
      "Curated products · Enabled",
      "Newsletter · Enabled",
    ],
  },
  Settings: {
    eyebrow: "SYSTEM",
    title: "Store settings",
    description:
      "Configure store details, shipping, payments, theme, and team access.",
    primary: "Save settings",
    secondary: "View permissions",
    rows: [
      "Store profile · Configured",
      "Shipping rules · 3 active",
      "Payment methods · Razorpay ready",
      "Admin roles · 4 configured",
    ],
  },
};

function ModuleWorkspace({
  module,
  onNotify,
}: {
  module: string;
  onNotify: (message: string) => void;
}) {
  if (module === "Products")
    return <ProductLibraryWorkspace onNotify={onNotify} />;
  if (module === "Categories") return <CategoryWorkspace onNotify={onNotify} />;
  if (module === "Orders") return <OrdersWorkspace onNotify={onNotify} />;
  if (module === "Homepage") return <HomepageWorkspace onNotify={onNotify} />;
  if (module === "Delivery charge")
    return <DeliveryChargeWorkspace onNotify={onNotify} />;
  if (module === "Marketing") return <MarketingWorkspace onNotify={onNotify} />;
  if (module === "Collections")
    return <CollectionsWorkspace onNotify={onNotify} />;
  if (module === "Customers") return <CustomersWorkspace onNotify={onNotify} />;
  if (module === "Settings") return <SettingsWorkspace onNotify={onNotify} />;
  const content = moduleContent[module] ?? {
    eyebrow: "WORKSPACE",
    title: module,
    description: `Manage ${module.toLowerCase()} from your Fanzzy control room.`,
    primary: "Create new",
    secondary: "View report",
    rows: ["Workspace ready", "No pending issues", "All systems operational"],
  };
  return (
    <section className="panel module-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">{content.eyebrow}</p>
          <h2>{content.title}</h2>
          <p>{content.description}</p>
        </div>
        <div className="module-actions">
          <button
            className="module-secondary"
            onClick={() => onNotify(`${content.secondary} opened`)}
          >
            {content.secondary} ↗
          </button>
          <button
            className="module-primary"
            onClick={() => onNotify(`${content.primary} opened`)}
          >
            + {content.primary}
          </button>
        </div>
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live workspace
        </span>
        <span>{content.rows.length} active records</span>
      </div>
      <div className="module-list">
        {content.rows.map((row, index) => (
          <button
            key={row}
            onClick={() => onNotify(`${row.split(" · ")[0]} selected`)}
          >
            <span className="module-row-number">0{index + 1}</span>
            <strong>{row.split(" · ")[0]}</strong>
            <small>{row.split(" · ").slice(1).join(" · ")}</small>
            <b>↗</b>
          </button>
        ))}
      </div>
    </section>
  );
}

type SettingsSection = "Store profile" | "Shipping rules" | "Payment methods" | "Admin roles";

function SettingsWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [selectedSection, setSelectedSection] = useState<SettingsSection | null>(null);
  const [profile, setProfile] = useState({
    storeName: "Fanzzy",
    email: "hello@fanzzy.in",
    whatsapp: "+91 98765 43210",
    address: "India",
  });
  const [shipping, setShipping] = useState({
    freeAbove: "999",
    processing: "1–2 business days",
    returns: "7 days",
  });
  const [payments, setPayments] = useState({
    online: true,
    cod: true,
    provider: "Razorpay",
  });
  const [roles, setRoles] = useState<AdminRole[]>(defaultAdminRoles);

  useEffect(() => {
    const read = <T,>(key: string, fallback: T): T => {
      const stored = window.localStorage.getItem(key);
      if (!stored) return fallback;
      try {
        return JSON.parse(stored) as T;
      } catch {
        return fallback;
      }
    };
    setProfile(read("fanzzy-store-profile", profile));
    setShipping(read("fanzzy-shipping-rules", shipping));
    setPayments(read("fanzzy-payment-methods", payments));
    const storedRoles = read<AdminRole[]>("fanzzy-admin-roles", defaultAdminRoles);
    setRoles(storedRoles.map((role, index) => ({
      id: role.id || `role-${index}`,
      name: role.name || "New role",
      title: role.title || "Team member",
      permissions: Array.isArray(role.permissions) ? role.permissions.filter((permission): permission is AdminPermission => allAdminPermissions.includes(permission as AdminPermission)) : ["Overview"],
    })));
    // These values are only read on mount; the defaults above provide the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = () => {
    window.localStorage.setItem("fanzzy-store-profile", JSON.stringify(profile));
    window.localStorage.setItem("fanzzy-shipping-rules", JSON.stringify(shipping));
    window.localStorage.setItem("fanzzy-payment-methods", JSON.stringify(payments));
    window.localStorage.setItem("fanzzy-admin-roles", JSON.stringify(roles));
    window.dispatchEvent(new Event("fanzzy-store-settings-updated"));
    onNotify("Store settings saved");
  };

  const statusFor = (section: SettingsSection) => {
    if (section === "Store profile") return profile.storeName ? "Configured" : "Needs details";
    if (section === "Shipping rules") return `${Object.values(shipping).filter(Boolean).length} active`;
    if (section === "Payment methods") return `${payments.online || payments.cod ? payments.provider + " ready" : "No methods active"}`;
    return `${roles.filter((role) => role.name.trim()).length} configured`;
  };

  return (
    <section className="panel module-workspace settings-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">SYSTEM</p>
          <h2>Store settings</h2>
          <p>Configure store details, shipping, payments, theme, and team access.</p>
        </div>
        <div className="module-actions">
          <button className="module-secondary" onClick={() => setSelectedSection("Admin roles")}>View permissions ↗</button>
          <button className="module-primary" onClick={saveSettings}>+ Save settings</button>
        </div>
      </div>
      <div className="module-summary"><span><i className="status-light" />Live workspace</span><span>4 active records</span></div>
      <div className="settings-list">
        {(["Store profile", "Shipping rules", "Payment methods", "Admin roles"] as SettingsSection[]).map((section, index) => (
          <button key={section} onClick={() => setSelectedSection(section)}>
            <span className="module-row-number">0{index + 1}</span>
            <strong>{section}</strong>
            <small>{statusFor(section)}</small>
            <b>↗</b>
          </button>
        ))}
      </div>

      {selectedSection && <div className="product-modal-backdrop" onClick={() => setSelectedSection(null)}>
        <div className="product-modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" onClick={(event) => event.stopPropagation()}>
          <button className="product-modal-close" aria-label="Close settings" onClick={() => setSelectedSection(null)}>×</button>
          <p className="eyebrow">STORE SETTINGS</p>
          <h3 id="settings-modal-title">{selectedSection}</h3>
          <p className="settings-modal-copy">Update this section and save once to keep the storefront and your team workspace in sync.</p>

          {selectedSection === "Store profile" && <div className="settings-form-grid">
            <label>Store name<input value={profile.storeName} onChange={(event) => setProfile((current) => ({ ...current, storeName: event.target.value }))} /></label>
            <label>Support email<input type="email" value={profile.email} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} /></label>
            <label>WhatsApp number<input type="tel" value={profile.whatsapp} onChange={(event) => setProfile((current) => ({ ...current, whatsapp: event.target.value }))} /></label>
            <label className="settings-wide">Business address<textarea value={profile.address} onChange={(event) => setProfile((current) => ({ ...current, address: event.target.value }))} rows={3} /></label>
          </div>}

          {selectedSection === "Shipping rules" && <div className="settings-form-grid">
            <label>Free shipping above (₹)<input inputMode="numeric" value={shipping.freeAbove} onChange={(event) => setShipping((current) => ({ ...current, freeAbove: event.target.value }))} /></label>
            <label>Processing time<input value={shipping.processing} onChange={(event) => setShipping((current) => ({ ...current, processing: event.target.value }))} /></label>
            <label>Returns window<input value={shipping.returns} onChange={(event) => setShipping((current) => ({ ...current, returns: event.target.value }))} /></label>
            <p className="settings-help">Use Delivery charge in the sidebar to turn on a paid delivery fee and set its amount.</p>
          </div>}

          {selectedSection === "Payment methods" && <div className="settings-payment-form">
            <label className="settings-check"><input type="checkbox" checked={payments.online} onChange={(event) => setPayments((current) => ({ ...current, online: event.target.checked }))} /><span>Online payments</span><small>Accept payments through your configured gateway.</small></label>
            <label className="settings-check"><input type="checkbox" checked={payments.cod} onChange={(event) => setPayments((current) => ({ ...current, cod: event.target.checked }))} /><span>Cash on delivery</span><small>Let customers choose COD at checkout.</small></label>
            <label>Payment provider<input value={payments.provider} onChange={(event) => setPayments((current) => ({ ...current, provider: event.target.value }))} /></label>
          </div>}

          {selectedSection === "Admin roles" && <div className="settings-roles-form"><div className="settings-role-list">{roles.map((role, index) => <div className="settings-role-card" key={role.id}><div className="settings-role-row"><input value={role.name} aria-label={`${role.name} name`} onChange={(event) => setRoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input value={role.title} aria-label={`${role.name} title`} onChange={(event) => setRoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><button aria-label={`Remove ${role.name}`} onClick={() => setRoles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div><div className="settings-permission-grid">{allAdminPermissions.map((permission) => <label key={permission}><input type="checkbox" checked={role.permissions.includes(permission)} onChange={(event) => setRoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, permissions: event.target.checked ? [...new Set([...item.permissions, permission])] : item.permissions.filter((itemPermission) => itemPermission !== permission) } : item))} /><span>{permission}</span></label>)}</div></div>)}</div><button className="module-secondary" onClick={() => setRoles((current) => [...current, { id: `role-${Date.now()}`, name: "New role", title: "Team member", permissions: ["Overview"] }])}>+ Add role</button></div>}

          <div className="settings-modal-actions"><button className="module-primary" onClick={() => { saveSettings(); setSelectedSection(null); }}>Save changes</button><button className="module-secondary" onClick={() => setSelectedSection(null)}>Cancel</button></div>
        </div>
      </div>}
    </section>
  );
}

type CollectionStatus = "Live" | "Draft" | "Scheduled";
type CollectionRecord = {
  id: string;
  name: string;
  detail: string;
  status: CollectionStatus;
  products: number;
  featured: boolean;
};
const defaultCollections: CollectionRecord[] = [
  {
    id: "everyday-gold",
    name: "Everyday Gold",
    detail: "Easy, polished pieces for every day.",
    status: "Live",
    products: 12,
    featured: true,
  },
  {
    id: "occasion-pieces",
    name: "Occasion pieces",
    detail: "Sculptural jewellery for memorable moments.",
    status: "Live",
    products: 18,
    featured: false,
  },
  {
    id: "gifting",
    name: "Gifting",
    detail: "Thoughtful pieces for someone special.",
    status: "Live",
    products: 9,
    featured: false,
  },
];

function CollectionsWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [records, setRecords] =
    useState<CollectionRecord[]>(defaultCollections);
  const [selected, setSelected] = useState<CollectionRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [featuredOpen, setFeaturedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    detail: "",
    status: "Draft" as CollectionStatus,
    products: "0",
  });

  useEffect(() => {
    let active = true;
    const loadCollections = async () => {
      const remote = await fetchStoreSetting("collections");
      const stored =
        remote.value || window.localStorage.getItem("fanzzy-collections");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as CollectionRecord[];
        if (active && Array.isArray(parsed) && parsed.length)
          setRecords(parsed);
      } catch {
        window.localStorage.removeItem("fanzzy-collections");
      }
    };
    void loadCollections();
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: CollectionRecord[], message: string) => {
    setRecords(next);
    window.localStorage.setItem("fanzzy-collections", JSON.stringify(next));
    window.dispatchEvent(new Event("fanzzy-collections-updated"));
    const remoteError = await saveStoreSetting(
      "collections",
      JSON.stringify(next),
    );
    onNotify(
      remoteError
        ? `${message} locally; Supabase needs setup`
        : `${message} on the storefront`,
    );
  };
  const openNew = () => {
    setSelected(null);
    setEditingId(null);
    setForm({ name: "", detail: "", status: "Draft", products: "0" });
    setFormOpen(true);
  };
  const openEdit = (record: CollectionRecord) => {
    setSelected(null);
    setEditingId(record.id);
    setForm({
      name: record.name,
      detail: record.detail,
      status: record.status,
      products: String(record.products),
    });
    setFormOpen(true);
  };
  const saveRecord = async () => {
    const name = form.name.trim();
    if (!name) return onNotify("Add a collection name before saving");
    const record: CollectionRecord = {
      id: editingId ?? `collection-${Date.now()}`,
      name,
      detail: form.detail.trim() || "A considered Fanzzy edit.",
      status: form.status,
      products: Math.max(0, Number(form.products) || 0),
      featured: editingId
        ? records.find((item) => item.id === editingId)?.featured === true
        : false,
    };
    const next = editingId
      ? records.map((item) => (item.id === editingId ? record : item))
      : [record, ...records];
    await persist(
      next,
      editingId ? "Collection updated" : "Collection created",
    );
    setFormOpen(false);
  };
  const removeRecord = async (record: CollectionRecord) => {
    if (!window.confirm(`Delete ${record.name}?`)) return;
    await persist(
      records.filter((item) => item.id !== record.id),
      `${record.name} deleted`,
    );
    setSelected(null);
  };
  const setFeatured = async (record: CollectionRecord) => {
    await persist(
      records.map((item) => ({ ...item, featured: item.id === record.id })),
      `${record.name} set as featured collection`,
    );
    setFeaturedOpen(false);
  };

  return (
    <section className="panel module-workspace collections-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">MERCHANDISING</p>
          <h2>Collections</h2>
          <p>Shape the edits customers see across the Fanzzy storefront.</p>
        </div>
        <div className="module-actions">
          <button
            className="module-secondary"
            onClick={() => setFeaturedOpen(true)}
          >
            Manage featured ↗
          </button>
          <button className="module-primary" onClick={openNew}>
            + New collection
          </button>
        </div>
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live workspace
        </span>
        <span>{records.length} active records</span>
      </div>
      <div className="module-list">
        {records.map((record, index) => (
          <div className="collection-list-row" key={record.id}>
            <button
              className="collection-list-main"
              onClick={() => setSelected(record)}
            >
              <span className="module-row-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{record.name}</strong>
              <small>
                {record.featured ? "Featured" : `${record.products} products`}
              </small>
              <b>↗</b>
            </button>
            <div className="product-row-actions">
              <button
                onClick={() => setSelected(record)}
                aria-label={`View ${record.name}`}
                title="View collection"
              >
                <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                onClick={() => openEdit(record)}
                aria-label={`Edit ${record.name}`}
                title="Edit collection"
              >
                <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                className="delete-action"
                onClick={() => removeRecord(record)}
                aria-label={`Delete ${record.name}`}
                title="Delete collection"
              >
                <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {selected && (
        <div
          className="product-modal-backdrop"
          onClick={() => setSelected(null)}
        >
          <div
            className="product-detail-card collection-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close collection details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <div className="product-detail-copy">
              <p className="eyebrow">COLLECTION DETAILS</p>
              <h3 id="collection-detail-title">{selected.name}</h3>
              <p className="product-detail-meta">{selected.detail}</p>
              <div className="product-detail-stats">
                <span>
                  <small>Status</small>
                  <strong>{selected.status}</strong>
                </span>
                <span>
                  <small>Products</small>
                  <strong>{selected.products}</strong>
                </span>
                <span>
                  <small>Featured</small>
                  <strong>{selected.featured ? "Yes" : "No"}</strong>
                </span>
              </div>
              <div className="product-detail-actions">
                <button
                  className="module-primary"
                  onClick={() => openEdit(selected)}
                >
                  Edit collection
                </button>
                <button
                  className="module-secondary"
                  onClick={() => setFeatured(selected)}
                >
                  {selected.featured ? "Featured" : "Set as featured"}
                </button>
                <button
                  className="delete-action"
                  onClick={() => removeRecord(selected)}
                >
                  Delete
                </button>
                <button
                  className="module-secondary"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {featuredOpen && (
        <div
          className="product-modal-backdrop"
          onClick={() => setFeaturedOpen(false)}
        >
          <div
            className="product-form-card product-modal-card collection-featured-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="featured-collection-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close featured collection manager"
              onClick={() => setFeaturedOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">FEATURED COLLECTION</p>
            <h3 id="featured-collection-title">
              Choose the storefront feature
            </h3>
            <div className="featured-collection-list">
              {records.map((record) => (
                <button
                  key={record.id}
                  className={record.featured ? "active" : ""}
                  onClick={() => setFeatured(record)}
                >
                  <span>
                    <strong>{record.name}</strong>
                    <small>
                      {record.products} products · {record.status}
                    </small>
                  </span>
                  <b>{record.featured ? "✓" : "→"}</b>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {formOpen && (
        <div
          className="product-modal-backdrop"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="product-form-card product-modal-card collection-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close collection form"
              onClick={() => setFormOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">
              {editingId ? "EDIT COLLECTION" : "NEW COLLECTION"}
            </p>
            <h3 id="collection-form-title">
              {editingId ? "Edit collection" : "Create a collection"}
            </h3>
            <div className="product-form-grid">
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Festive edit"
                />
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as CollectionStatus,
                    }))
                  }
                >
                  <option>Live</option>
                  <option>Scheduled</option>
                  <option>Draft</option>
                </select>
              </label>
              <label>
                Products
                <input
                  type="number"
                  min="0"
                  value={form.products}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      products: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="marketing-form-wide">
                Description
                <input
                  value={form.detail}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      detail: event.target.value,
                    }))
                  }
                  placeholder="What makes this edit special?"
                />
              </label>
            </div>
            <div className="product-detail-actions">
              <button className="module-primary" onClick={saveRecord}>
                Save collection
              </button>
              <button
                className="module-secondary"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type CustomerRecord = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  orders: number;
  totalSpent: string;
  lastOrder: string;
  joined: string;
};
const defaultCustomers: CustomerRecord[] = [
  {
    id: "customer-amrita",
    name: "Amrita Mehra",
    phone: "+91 98765 43210",
    email: "amrita@example.com",
    address: "New Delhi, India",
    orders: 12,
    totalSpent: "₹28,400",
    lastOrder: "#FZ-1048",
    joined: "12 Jan 2025",
  },
  {
    id: "customer-riya",
    name: "Riya Sharma",
    phone: "+91 98765 43211",
    email: "riya@example.com",
    address: "Mumbai, Maharashtra",
    orders: 8,
    totalSpent: "₹14,820",
    lastOrder: "#FZ-1047",
    joined: "04 Mar 2025",
  },
  {
    id: "customer-nisha",
    name: "Nisha Kapoor",
    phone: "+91 98765 43212",
    email: "nisha@example.com",
    address: "Bengaluru, Karnataka",
    orders: 5,
    totalSpent: "₹9,610",
    lastOrder: "#FZ-1046",
    joined: "19 Jun 2025",
  },
  {
    id: "customer-aarav",
    name: "Aarav Menon",
    phone: "+91 98765 43213",
    email: "aarav@example.com",
    address: "Kochi, Kerala",
    orders: 3,
    totalSpent: "₹4,980",
    lastOrder: "#FZ-1045",
    joined: "22 Aug 2025",
  },
];

function CustomersWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [customers, setCustomers] =
    useState<CustomerRecord[]>(defaultCustomers);
  const [selected, setSelected] = useState<CustomerRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
  });

  useEffect(() => {
    let active = true;
    const loadCustomers = async () => {
      const remote = await fetchStoreSetting("customers");
      const stored =
        remote.value || window.localStorage.getItem("fanzzy-customers");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as CustomerRecord[];
        if (active && Array.isArray(parsed) && parsed.length)
          setCustomers(parsed);
      } catch {
        window.localStorage.removeItem("fanzzy-customers");
      }
    };
    void loadCustomers();
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: CustomerRecord[], message: string) => {
    setCustomers(next);
    window.localStorage.setItem("fanzzy-customers", JSON.stringify(next));
    window.dispatchEvent(new Event("fanzzy-customers-updated"));
    const remoteError = await saveStoreSetting(
      "customers",
      JSON.stringify(next),
    );
    onNotify(
      remoteError
        ? `${message} locally; Supabase needs setup`
        : `${message} successfully`,
    );
  };
  const openNew = () => {
    setForm({ name: "", phone: "", email: "", address: "" });
    setFormOpen(true);
  };
  const saveCustomer = async () => {
    if (!form.name.trim()) return onNotify("Customer name is required");
    if (!form.phone.trim()) return onNotify("WhatsApp number is required");
    const customer: CustomerRecord = {
      id: `customer-${Date.now()}`,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || "Not provided",
      address: form.address.trim() || "Not provided",
      orders: 0,
      totalSpent: "₹0",
      lastOrder: "No orders yet",
      joined: new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date()),
    };
    await persist([customer, ...customers], `${customer.name} added`);
    setFormOpen(false);
  };
  const removeCustomer = async (customer: CustomerRecord) => {
    if (!window.confirm(`Delete ${customer.name}?`)) return;
    await persist(
      customers.filter((item) => item.id !== customer.id),
      `${customer.name} deleted`,
    );
    setSelected(null);
  };
  const exportCustomers = () => {
    const header =
      "Name,WhatsApp,Email,Address,Orders,Total spent,Last order,Joined";
    const rows = customers.map((customer) =>
      [
        customer.name,
        customer.phone,
        customer.email,
        customer.address,
        customer.orders,
        customer.totalSpent,
        customer.lastOrder,
        customer.joined,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fanzzy-customers.csv";
    link.click();
    URL.revokeObjectURL(url);
    onNotify("Customer list exported");
  };

  return (
    <section className="panel module-workspace customers-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">RELATIONSHIPS</p>
          <h2>Customers</h2>
          <p>Understand your community and support every order with care.</p>
        </div>
        <div className="module-actions">
          <button className="module-secondary" onClick={exportCustomers}>
            Export list ↗
          </button>
          <button className="module-primary" onClick={openNew}>
            + Add customer
          </button>
        </div>
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live workspace
        </span>
        <span>{customers.length} active records</span>
      </div>
      <div className="module-list">
        {customers.map((customer, index) => (
          <div className="customer-list-row" key={customer.id}>
            <button
              className="customer-list-main"
              onClick={() => setSelected(customer)}
            >
              <span className="module-row-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{customer.name}</strong>
              <small>
                {customer.orders} orders · {customer.totalSpent}
              </small>
              <b>↗</b>
            </button>
            <div className="product-row-actions">
              <button
                onClick={() => setSelected(customer)}
                aria-label={`View ${customer.name}`}
                title="View customer"
              >
                <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                className="delete-action"
                onClick={() => removeCustomer(customer)}
                aria-label={`Delete ${customer.name}`}
                title="Delete customer"
              >
                <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {selected && (
        <div
          className="product-modal-backdrop"
          onClick={() => setSelected(null)}
        >
          <div
            className="product-detail-card customer-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close customer details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <div className="product-detail-copy">
              <p className="eyebrow">CUSTOMER PROFILE</p>
              <h3 id="customer-detail-title">{selected.name}</h3>
              <p className="product-detail-meta">
                Customer since {selected.joined}
              </p>
              <div className="customer-detail-grid">
                <div>
                  <small>WhatsApp</small>
                  <strong>{selected.phone}</strong>
                </div>
                <div>
                  <small>Email</small>
                  <strong>{selected.email}</strong>
                </div>
                <div>
                  <small>Address</small>
                  <strong>{selected.address}</strong>
                </div>
                <div>
                  <small>Orders</small>
                  <strong>{selected.orders}</strong>
                </div>
                <div>
                  <small>Total spent</small>
                  <strong>{selected.totalSpent}</strong>
                </div>
                <div>
                  <small>Last order</small>
                  <strong>{selected.lastOrder}</strong>
                </div>
              </div>
              <div className="product-detail-actions">
                <a
                  className="whatsapp-action"
                  href={`https://wa.me/${selected.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp ↗
                </a>
                <button
                  className="delete-action"
                  onClick={() => removeCustomer(selected)}
                >
                  Delete
                </button>
                <button
                  className="module-secondary"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {formOpen && (
        <div
          className="product-modal-backdrop"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="product-form-card product-modal-card customer-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close customer form"
              onClick={() => setFormOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">NEW CUSTOMER</p>
            <h3 id="customer-form-title">Add a customer</h3>
            <div className="product-form-grid">
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Full name"
                />
              </label>
              <label>
                WhatsApp number
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  placeholder="+91 98765 43210"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Address
                <input
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                  placeholder="City, state"
                />
              </label>
            </div>
            <div className="product-detail-actions">
              <button className="module-primary" onClick={saveCustomer}>
                Save customer
              </button>
              <button
                className="module-secondary"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MarketingWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [records, setRecords] = useState<MarketingRecord[]>(
    defaultMarketingRecords,
  );
  const [selected, setSelected] = useState<MarketingRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: "Campaign" as MarketingKind,
    name: "",
    detail: "",
    status: "Draft" as MarketingStatus,
    code: "",
    discount: "",
  });

  useEffect(() => {
    let active = true;
    const loadRecords = async () => {
      const remote = await fetchStoreSetting("marketingRecords");
      const stored =
        remote.value || window.localStorage.getItem("fanzzy-marketing-records");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as MarketingRecord[];
        const valid = Array.isArray(parsed)
          ? parsed.filter((record) => record?.id && record?.name)
          : [];
        if (!active || !valid.length) return;
        setRecords(valid);
        if (!remote.error && !remote.value)
          await saveStoreSetting("marketingRecords", JSON.stringify(valid));
      } catch {
        // Keep the built-in marketing records when saved data is unavailable.
      }
    };
    void loadRecords();
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: MarketingRecord[], message: string) => {
    setRecords(next);
    window.localStorage.setItem(
      "fanzzy-marketing-records",
      JSON.stringify(next),
    );
    window.dispatchEvent(new Event("fanzzy-marketing-updated"));
    const remoteError = await saveStoreSetting(
      "marketingRecords",
      JSON.stringify(next),
    );
    onNotify(
      remoteError
        ? `${message} locally; Supabase needs setup`
        : `${message} on the storefront`,
    );
  };

  const openNew = (kind: MarketingKind) => {
    setSelected(null);
    setEditingId(null);
    setForm({
      kind,
      name: "",
      detail: kind === "Coupon" ? "First order discount" : "",
      status: kind === "Campaign" ? "Scheduled" : "Active",
      code: "",
      discount: kind === "Coupon" ? "10% off" : "",
    });
    setFormOpen(true);
  };

  const openEdit = (record: MarketingRecord) => {
    setSelected(null);
    setEditingId(record.id);
    setForm({
      kind: record.kind,
      name: record.name,
      detail: record.detail,
      status: record.status,
      code: record.code ?? "",
      discount: record.discount ?? "",
    });
    setFormOpen(true);
  };

  const saveRecord = async () => {
    const name = form.name.trim();
    if (!name) {
      onNotify("Add a name before saving");
      return;
    }
    const record: MarketingRecord = {
      id: editingId ?? `${form.kind.toLowerCase()}-${Date.now()}`,
      kind: form.kind,
      name,
      detail: form.detail.trim() || "Fanzzy promotion",
      status: form.status,
      ...(form.code.trim() ? { code: form.code.trim().toUpperCase() } : {}),
      ...(form.discount.trim() ? { discount: form.discount.trim() } : {}),
    };
    const next = editingId
      ? records.map((item) => (item.id === editingId ? record : item))
      : [record, ...records];
    await persist(
      next,
      editingId ? "Marketing record updated" : `${form.kind} created`,
    );
    setFormOpen(false);
  };

  const removeRecord = async (record: MarketingRecord) => {
    if (!window.confirm(`Delete ${record.name}?`)) return;
    await persist(
      records.filter((item) => item.id !== record.id),
      `${record.name} deleted`,
    );
    setSelected(null);
  };

  const toggleStatus = async (record: MarketingRecord) => {
    const nextStatus: MarketingStatus =
      record.status === "Active" ? "Draft" : "Active";
    await persist(
      records.map((item) =>
        item.id === record.id ? { ...item, status: nextStatus } : item,
      ),
      `${record.name} ${nextStatus === "Active" ? "activated" : "paused"}`,
    );
    setSelected((current) =>
      current?.id === record.id ? { ...record, status: nextStatus } : current,
    );
  };

  return (
    <section className="panel module-workspace marketing-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">GROWTH</p>
          <h2>Marketing studio</h2>
          <p>
            Manage campaigns, coupons, and the messages that bring customers
            back.
          </p>
        </div>
        <div className="module-actions">
          <button
            className="module-secondary"
            onClick={() => openNew("Coupon")}
          >
            New coupon ↗
          </button>
          <button
            className="module-primary"
            onClick={() => openNew("Campaign")}
          >
            + Create campaign
          </button>
        </div>
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live workspace
        </span>
        <span>{records.length} active records</span>
      </div>
      <div className="marketing-list">
        {records.map((record, index) => (
          <div className="marketing-list-row" key={record.id}>
            <button
              className="marketing-list-main"
              onClick={() => setSelected(record)}
            >
              <span className="module-row-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{record.name}</strong>
              <small>{record.discount || record.status}</small>
              <b>↗</b>
            </button>
            <div className="product-row-actions">
              <button
                onClick={() => openEdit(record)}
                aria-label={`Edit ${record.name}`}
                title="Edit record"
              >
                <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                className="delete-action"
                onClick={() => removeRecord(record)}
                aria-label={`Delete ${record.name}`}
                title="Delete record"
              >
                <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {selected && (
        <div
          className="product-modal-backdrop"
          onClick={() => setSelected(null)}
        >
          <div
            className="product-detail-card marketing-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketing-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="product-detail-copy">
              <p className="eyebrow">{selected.kind}</p>
              <h3 id="marketing-detail-title">{selected.name}</h3>
              <p className="product-detail-meta">{selected.detail}</p>
              <div className="product-detail-stats">
                <span>
                  <small>Status</small>
                  <strong>{selected.status}</strong>
                </span>
                {selected.discount && (
                  <span>
                    <small>Offer</small>
                    <strong>{selected.discount}</strong>
                  </span>
                )}
                {selected.code && (
                  <span>
                    <small>Code</small>
                    <strong>{selected.code}</strong>
                  </span>
                )}
              </div>
              <div className="product-detail-actions">
                <button
                  className="module-primary"
                  onClick={() => openEdit(selected)}
                >
                  Edit record
                </button>
                <button
                  className="module-secondary"
                  onClick={() => toggleStatus(selected)}
                >
                  {selected.status === "Active" ? "Pause" : "Activate"}
                </button>
                <button
                  className="module-secondary"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {formOpen && (
        <div
          className="product-modal-backdrop"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="product-form-card product-modal-card marketing-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketing-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close marketing form"
              onClick={() => setFormOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">
              {editingId ? "EDIT RECORD" : `NEW ${form.kind.toUpperCase()}`}
            </p>
            <h3 id="marketing-form-title">
              {editingId
                ? "Edit marketing record"
                : `Create ${form.kind.toLowerCase()}`}
            </h3>
            <div className="product-form-grid">
              <label>
                Type
                <select
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: event.target.value as MarketingKind,
                    }))
                  }
                >
                  <option>Campaign</option>
                  <option>Coupon</option>
                  <option>Newsletter</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as MarketingStatus,
                    }))
                  }
                >
                  <option>Active</option>
                  <option>Scheduled</option>
                  <option>Draft</option>
                </select>
              </label>
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Diwali edit"
                />
              </label>
              <label>
                Offer / audience
                <input
                  value={form.discount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      discount: event.target.value,
                    }))
                  }
                  placeholder="e.g. 15% off"
                />
              </label>
              <label className="marketing-form-wide">
                Description
                <input
                  value={form.detail}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      detail: event.target.value,
                    }))
                  }
                  placeholder="What should customers know?"
                />
              </label>
              {form.kind === "Coupon" && (
                <label>
                  Coupon code
                  <input
                    value={form.code}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        code: event.target.value,
                      }))
                    }
                    placeholder="e.g. FANZZY15"
                  />
                </label>
              )}
            </div>
            <div className="product-detail-actions">
              <button className="module-primary" onClick={saveRecord}>
                Save record
              </button>
              <button
                className="module-secondary"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function OrdersWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [orders, setOrders] = useState<OrderRecord[]>(adminOrders);
  const [filter, setFilter] = useState<OrderDateFilter>("this-month");
  const [fromDate, setFromDate] = useState("2026-08-01");
  const [toDate, setToDate] = useState("2026-08-08");
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [phone, setPhone] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("fanzzy-orders");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as OrderRecord[];
      if (Array.isArray(parsed) && parsed.length) setOrders(parsed);
    } catch {
      window.localStorage.removeItem("fanzzy-orders");
    }
  }, []);

  const persistOrders = (next: OrderRecord[]) => {
    setOrders(next);
    window.localStorage.setItem("fanzzy-orders", JSON.stringify(next));
  };

  const filteredOrders = useMemo(() => {
    const latestDate = "2026-08-08";
    const latest = new Date(`${latestDate}T00:00:00`);
    let from = "0000-01-01";
    let to = latestDate;
    if (filter === "today") from = latestDate;
    if (filter === "this-week") {
      const weekStart = new Date(latest);
      weekStart.setDate(latest.getDate() - 6);
      from = weekStart.toISOString().slice(0, 10);
    }
    if (filter === "this-month") from = latestDate.slice(0, 8) + "01";
    if (filter === "custom") {
      from = fromDate || "0000-01-01";
      to = toDate || latestDate;
    }
    return orders.filter((order) => order.date >= from && order.date <= to);
  }, [orders, filter, fromDate, toDate]);

  const formatOrderDate = (value: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  const openOrder = (order: OrderRecord) => {
    setSelectedOrder(order);
    setPhone(order.phone);
  };
  const saveOrder = () => {
    if (!selectedOrder) return;
    const updated = { ...selectedOrder, phone: phone.trim() };
    persistOrders(
      orders.map((order) => (order.id === updated.id ? updated : order)),
    );
    setSelectedOrder(null);
    onNotify(`${updated.id} saved`);
  };
  const updateOrderStatus = (status: OrderStatus) => {
    if (!selectedOrder) return;
    const updated = { ...selectedOrder, status };
    setSelectedOrder(updated);
    persistOrders(
      orders.map((order) => (order.id === updated.id ? updated : order)),
    );
    onNotify(`${updated.id} marked ${status}`);
  };
  const sendWhatsApp = () => {
    if (!selectedOrder) return;
    const digits = phone.replace(/\D/g, "");
    if (!digits) {
      onNotify("Add the customer's WhatsApp number first");
      return;
    }
    saveOrder();
    const message = `Hello ${selectedOrder.customerName}, this is fanZZy regarding order ${selectedOrder.id}. Current status: ${selectedOrder.status}. Order total: ${selectedOrder.total}.`;
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <section className="panel module-workspace orders-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h2>Orders</h2>
          <p>
            Review orders, update their status, and message customers manually.
          </p>
        </div>
        <div className="module-actions">
          <button
            className="module-secondary"
            onClick={() => onNotify("Pending orders opened")}
          >
            View pending ↗
          </button>
          <button
            className="module-primary"
            onClick={() => onNotify("Orders export started")}
          >
            Export orders
          </button>
        </div>
      </div>
      <div className="order-filter-bar">
        <div>
          <p className="eyebrow">DATE FILTER</p>
          <div
            className="order-date-presets"
            role="group"
            aria-label="Order date presets"
          >
            <button
              className={filter === "today" ? "active" : ""}
              onClick={() => setFilter("today")}
            >
              Today
            </button>
            <button
              className={filter === "this-week" ? "active" : ""}
              onClick={() => setFilter("this-week")}
            >
              This week
            </button>
            <button
              className={filter === "this-month" ? "active" : ""}
              onClick={() => setFilter("this-month")}
            >
              This month
            </button>
            <button
              className={filter === "all-time" ? "active" : ""}
              onClick={() => setFilter("all-time")}
            >
              All dates
            </button>
            <button
              className={filter === "custom" ? "active" : ""}
              onClick={() => setFilter("custom")}
            >
              Custom
            </button>
          </div>
        </div>
        {filter === "custom" && (
          <div className="order-date-fields">
            <label>
              From
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          {filteredOrders.length} orders found
        </span>
        <span>
          {filter === "custom"
            ? `${fromDate || "Any date"} → ${toDate || "Any date"}`
            : filter
                .replace("this-", "This ")
                .replace("all-time", "All dates")
                .replace("today", "Today")}
        </span>
      </div>
      <div className="order-list">
        {filteredOrders.map((order) => (
          <button key={order.id} onClick={() => openOrder(order)}>
            <span>
              <strong>{order.id}</strong>
              <small>{formatOrderDate(order.date)}</small>
            </span>
            <i className={`status-pill ${order.status.toLowerCase()}`}>
              {order.status}
            </i>
            <b>{order.total}</b>
            <em>↗</em>
          </button>
        ))}
      </div>
      {filteredOrders.length === 0 && (
        <p className="empty-filter">No orders found for these dates.</p>
      )}
      {selectedOrder && (
        <div
          className="product-modal-backdrop"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="product-detail-card order-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close order details"
              onClick={() => setSelectedOrder(null)}
            >
              ×
            </button>
            <div className="product-detail-copy">
              <p className="eyebrow">ORDER DETAILS</p>
              <h3 id="order-detail-title">{selectedOrder.id}</h3>
              <p className="product-detail-meta">
                {selectedOrder.customerName} ·{" "}
                {formatOrderDate(selectedOrder.date)} · {selectedOrder.total}
              </p>
              <div className="order-status-editor">
                <label>
                  Status
                  <select
                    value={selectedOrder.status}
                    onChange={(event) =>
                      updateOrderStatus(event.target.value as OrderStatus)
                    }
                  >
                    <option>Processing</option>
                    <option>Packed</option>
                    <option>Shipped</option>
                    <option>Delivered</option>
                    <option>Cancelled</option>
                  </select>
                </label>
              </div>
              <label className="order-whatsapp-field">
                Customer WhatsApp number
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="e.g. +91 98765 43210"
                />
              </label>
              <p className="order-whatsapp-help">
                Save the number, then open WhatsApp to send the message
                manually.
              </p>
              <div className="product-detail-actions">
                <button className="module-primary" onClick={saveOrder}>
                  Save order
                </button>
                <button className="whatsapp-action" onClick={sendWhatsApp}>
                  Send WhatsApp ↗
                </button>
                <button
                  className="module-secondary"
                  onClick={() => setSelectedOrder(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DeliveryChargeWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(defaultDeliveryCharge.enabled);
  const [amount, setAmount] = useState(String(defaultDeliveryCharge.amount));

  useEffect(() => {
    let active = true;
    const loadDeliveryCharge = async () => {
      const remote = await fetchStoreSetting("deliveryCharge");
      const stored =
        remote.value || window.localStorage.getItem("fanzzy-delivery-charge");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as {
          enabled?: boolean;
          amount?: number;
        };
        if (active) {
          setEnabled(parsed.enabled === true);
          setAmount(
            String(
              Number.isFinite(parsed.amount)
                ? parsed.amount
                : defaultDeliveryCharge.amount,
            ),
          );
        }
      } catch {
        window.localStorage.removeItem("fanzzy-delivery-charge");
      }
    };
    void loadDeliveryCharge();
    return () => {
      active = false;
    };
  }, []);

  const saveDeliveryCharge = async () => {
    const nextAmount = Math.max(0, Number(amount) || 0);
    const value = JSON.stringify({ enabled, amount: nextAmount });
    const remoteError = await saveStoreSetting("deliveryCharge", value);
    window.localStorage.setItem("fanzzy-delivery-charge", value);
    window.dispatchEvent(new Event("fanzzy-delivery-charge-updated"));
    onNotify(
      remoteError
        ? "Delivery charge saved locally; Supabase needs its tables"
        : "Delivery charge updated on storefront",
    );
  };

  return (
    <section className="panel module-workspace delivery-charge-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">CHECKOUT SETTINGS</p>
          <h2>Delivery charge</h2>
          <p>
            Choose whether a delivery fee appears in the customer’s bag and
            checkout summary.
          </p>
        </div>
        <div className="module-actions">
          <button className="module-primary" onClick={saveDeliveryCharge}>
            Save changes
          </button>
        </div>
      </div>
      <div className="delivery-charge-card">
        <div>
          <p className="eyebrow">DELIVERY FEE</p>
          <h3>
            {enabled
              ? "Delivery charge is enabled"
              : "Delivery is currently free"}
          </h3>
          <p>
            {enabled
              ? "Customers will see this fee added to their order total."
              : "No delivery fee will be added to customer orders."}
          </p>
        </div>
        <button
          className={`delivery-toggle ${enabled ? "enabled" : ""}`}
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((current) => !current)}
        >
          <span />
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>
      <label className="delivery-amount-field">
        Charge amount
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="Delivery charge amount"
        />
        <small>Displayed in INR on the storefront.</small>
      </label>
      <div className="module-summary">
        <span>
          <i
            className={`status-light ${enabled ? "" : "delivery-off-light"}`}
          />
          {enabled ? "Live fee" : "No fee active"}
        </span>
        <span>
          {enabled
            ? `₹${(Number(amount) || 0).toLocaleString("en-IN")} per order`
            : "Free delivery"}
        </span>
      </div>
    </section>
  );
}

function HomepageWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [heroImages, setHeroImages] = useState(defaultHeroSlides);
  const [pendingImages, setPendingImages] = useState(defaultHeroSlides);
  const [pendingFiles, setPendingFiles] = useState<Array<File | null>>([
    null,
    null,
    null,
    null,
  ]);
  const [slideDuration, setSlideDuration] = useState(
    String(defaultHeroSlideDuration),
  );

  useEffect(() => {
    let active = true;
    const loadHeroImages = async () => {
      const remoteDuration = await fetchStoreSetting("heroSlideDuration");
      const storedDuration =
        remoteDuration.value ||
        window.localStorage.getItem("fanzzy-hero-slide-duration");
      if (active && storedDuration) {
        const parsedDuration = Number(storedDuration);
        if (Number.isFinite(parsedDuration))
          setSlideDuration(String(Math.min(30, Math.max(2, parsedDuration))));
      }
      const remoteSlides = await fetchStoreSetting("heroSlides");
      const storedSlides =
        remoteSlides.value || window.localStorage.getItem("fanzzy-hero-slides");
      if (storedSlides) {
        try {
          const parsed = JSON.parse(storedSlides);
          if (Array.isArray(parsed) && parsed.length) {
            const next = parsed
              .slice(0, 4)
              .map((value) => (typeof value === "string" ? value : ""));
            while (next.length < 4) next.push("");
            if (active) {
              setHeroImages(next);
              setPendingImages(next);
            }
            return;
          }
        } catch {
          window.localStorage.removeItem("fanzzy-hero-slides");
        }
      }
      const legacy = await fetchStoreSetting("heroImage");
      const storedLegacy =
        legacy.value || window.localStorage.getItem("fanzzy-hero-image");
      if (active && storedLegacy) {
        const next = [storedLegacy, ...defaultHeroSlides.slice(1)];
        setHeroImages(next);
        setPendingImages(next);
      }
    };
    void loadHeroImages();
    return () => {
      active = false;
    };
  }, []);

  const uploadHeroImage = (
    event: React.ChangeEvent<HTMLInputElement>,
    index: number,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingFiles((current) =>
      current.map((value, fileIndex) => (fileIndex === index ? file : value)),
    );
    const reader = new FileReader();
    reader.onload = () =>
      setPendingImages((current) =>
        current.map((value, imageIndex) =>
          imageIndex === index ? String(reader.result) : value,
        ),
      );
    reader.readAsDataURL(file);
  };

  const removeHeroImage = (index: number) => {
    if (!pendingImages[index])
      return onNotify("There is no image in this slide");
    if (pendingImages.filter((image) => image.trim()).length <= 1)
      return onNotify("Keep at least one homepage image");
    setPendingImages((current) =>
      current.map((image, imageIndex) => (imageIndex === index ? "" : image)),
    );
    setPendingFiles((current) =>
      current.map((file, fileIndex) => (fileIndex === index ? null : file)),
    );
    onNotify(
      `Slide ${index + 1} image removed. Save changes to update the homepage.`,
    );
  };

  const saveHeroImage = async () => {
    const nextImages = [...pendingImages];
    let imageSavedLocally = false;
    for (let index = 0; index < pendingFiles.length; index += 1) {
      const file = pendingFiles[index];
      if (!file) continue;
      if (file) {
        try {
          nextImages[index] = await makeLocalImage(file);
        } catch {
          /* keep the preview */
        }
        if (isSupabaseReady) {
          const upload = await uploadStoreImage(file, "homepage");
          if (upload.error || !upload.url) {
            imageSavedLocally = true;
          } else {
            nextImages[index] = upload.url;
          }
        }
      }
    }
    const activeImages = nextImages.filter((image) => image.trim());
    if (!activeImages.length)
      return onNotify("Keep at least one homepage image");
    const remoteSlidesError = await saveStoreSetting(
      "heroSlides",
      JSON.stringify(nextImages),
    );
    const legacyError = await saveStoreSetting("heroImage", activeImages[0]);
    const nextDuration = Math.min(
      30,
      Math.max(2, Number(slideDuration) || defaultHeroSlideDuration),
    );
    const durationError = await saveStoreSetting(
      "heroSlideDuration",
      String(nextDuration),
    );
    window.localStorage.setItem(
      "fanzzy-hero-slides",
      JSON.stringify(nextImages),
    );
    window.localStorage.setItem("fanzzy-hero-image", activeImages[0]);
    window.localStorage.setItem(
      "fanzzy-hero-slide-duration",
      String(nextDuration),
    );
    window.dispatchEvent(new Event("fanzzy-hero-updated"));
    window.dispatchEvent(new Event("fanzzy-hero-slides-updated"));
    setHeroImages(nextImages);
    setPendingImages(nextImages);
    setPendingFiles([null, null, null, null]);
    setSlideDuration(String(nextDuration));
    onNotify(
      remoteSlidesError || legacyError || durationError
        ? "Slider saved locally; Supabase needs setup"
        : imageSavedLocally
          ? "Slider saved locally until storage is connected"
          : "Homepage slider updated",
    );
  };

  return (
    <section className="panel module-workspace homepage-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">CONTENT</p>
          <h2>Homepage builder</h2>
          <p>Manage the four full-screen images used by the hero slider.</p>
        </div>
        <div className="module-actions">
          <button
            className="module-secondary"
            onClick={() => window.location.assign("/")}
          >
            Preview homepage ↗
          </button>
          <button className="module-primary" onClick={saveHeroImage}>
            Save changes
          </button>
        </div>
      </div>
      <div className="homepage-slider-editor">
        {pendingImages.map((image, index) => (
          <div className="homepage-slide-editor" key={index}>
            <div className="homepage-hero-preview">
              {image ? (
                <img src={image} alt={`Homepage slider image ${index + 1}`} />
              ) : (
                <span className="empty-hero-preview">No image selected</span>
              )}
            </div>
            <div className="homepage-hero-copy">
              <p className="eyebrow">SLIDE 0{index + 1}</p>
              <h3>Hero image {index + 1}</h3>
              <label className="hero-upload-button">
                Choose image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => uploadHeroImage(event, index)}
                />
              </label>
              <button
                className="hero-remove-button"
                onClick={() => removeHeroImage(index)}
                disabled={!image}
              >
                Remove image
              </button>
              <small>
                {!image
                  ? "No image selected"
                  : heroImages[index] === image
                    ? "Current image"
                    : "Unsaved image change"}
              </small>
            </div>
          </div>
        ))}
      </div>
      <div className="homepage-slider-duration">
        <label>
          Slide duration (seconds)
          <input
            type="number"
            min="2"
            max="30"
            step="0.1"
            value={slideDuration}
            onChange={(event) => setSlideDuration(event.target.value)}
            aria-label="Slide duration in seconds"
          />
          <small>Each image stays visible for this many seconds.</small>
        </label>
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live storefront sync
        </span>
        <span>
          {pendingImages.filter((image) => image.trim()).length} active slides ·
          Right-sliding hero
        </span>
      </div>
    </section>
  );
}

function CategoryWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [categories, setCategories] = useState([
    { name: "Earrings", pieces: 42, image: defaultCategoryImages.Earrings },
    { name: "Necklaces", pieces: 28, image: defaultCategoryImages.Necklaces },
    { name: "Bracelets", pieces: 18, image: defaultCategoryImages.Bracelets },
    { name: "Rings", pieces: 24, image: defaultCategoryImages.Rings },
  ]);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [categoryImage, setCategoryImage] = useState(
    defaultCategoryImages.Earrings,
  );
  const [categoryFile, setCategoryFile] = useState<File | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<{
    name: string;
    pieces: number;
    image?: string;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      const remote = await fetchCatalogCategories();
      if (active && !remote.error && remote.data) {
        const mapped = remote.data.map((category) => ({
          name: category.name,
          pieces: category.pieces,
          image:
            category.image ||
            defaultCategoryImages[category.name] ||
            defaultCategoryImages.Earrings,
        }));
        setCategories(mapped);
        persistCategories(mapped);
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-categories");
      if (active && stored) {
        try {
          setCategories(JSON.parse(stored));
        } catch {
          window.localStorage.removeItem("fanzzy-categories");
        }
      }
    };
    void loadCategories();
    return () => {
      active = false;
    };
  }, []);
  const saveCategory = async () => {
    if (!name.trim()) return onNotify("Category name is required");
    let nextImage = categoryImage;
    let imageSavedLocally = false;
    if (categoryFile) {
      try {
        nextImage = await makeLocalImage(categoryFile);
      } catch {
        /* keep the preview */
      }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(categoryFile, "categories");
        if (upload.error || !upload.url) imageSavedLocally = true;
        else nextImage = upload.url;
      }
    }
    const category = { name: name.trim(), pieces: 0, image: nextImage };
    const remoteError = await saveCatalogCategory(category);
    setCategories((current) => [...current, category]);
    persistCategories([...categories, category]);
    setName("");
    setCategoryImage(defaultCategoryImages.Earrings);
    setCategoryFile(null);
    setIsAdding(false);
    onNotify(
      remoteError
        ? "Category saved locally; Supabase needs setup"
        : imageSavedLocally
          ? `${category.name} added; image saved locally until storage is connected`
          : `${category.name} category added`,
    );
  };
  const openCategory = (category: {
    name: string;
    pieces: number;
    image?: string;
  }) => {
    setSelectedCategory(category);
    setIsEditing(false);
    onNotify(`${category.name} category selected`);
  };
  const startEditingCategory = (category: {
    name: string;
    pieces: number;
    image?: string;
  }) => {
    setSelectedCategory(category);
    setEditName(category.name);
    setEditImage(
      category.image ||
        defaultCategoryImages[category.name] ||
        defaultCategoryImages.Earrings,
    );
    setEditImageFile(null);
    setIsEditing(true);
  };
  const saveCategoryEdit = async () => {
    if (!selectedCategory || !editName.trim())
      return onNotify("Category name is required");
    let nextImage = editImage;
    let imageSavedLocally = false;
    if (editImageFile) {
      try {
        nextImage = await makeLocalImage(editImageFile);
      } catch {
        /* keep the preview */
      }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(editImageFile, "categories");
        if (upload.error || !upload.url) imageSavedLocally = true;
        else nextImage = upload.url;
      }
    }
    const updatedCategory = {
      ...selectedCategory,
      name: editName.trim(),
      image: nextImage,
    };
    const remoteError = await renameCatalogCategory(
      selectedCategory.name,
      updatedCategory,
    );
    setCategories((current) =>
      current.map((category) =>
        category.name === selectedCategory.name ? updatedCategory : category,
      ),
    );
    persistCategories(
      categories.map((category) =>
        category.name === selectedCategory.name ? updatedCategory : category,
      ),
    );
    setSelectedCategory(updatedCategory);
    setEditImageFile(null);
    setIsEditing(false);
    onNotify(
      remoteError
        ? "Category saved locally; Supabase needs setup"
        : imageSavedLocally
          ? `${updatedCategory.name} updated; image saved locally until storage is connected`
          : `${updatedCategory.name} category updated`,
    );
  };
  const deleteCategory = async (category: {
    name: string;
    pieces: number;
    image?: string;
  }) => {
    if (!window.confirm(`Delete ${category.name}?`)) return;
    const remoteError = await removeCatalogCategory(category.name);
    setCategories((current) =>
      current.filter((item) => item.name !== category.name),
    );
    persistCategories(categories.filter((item) => item.name !== category.name));
    if (selectedCategory?.name === category.name) setSelectedCategory(null);
    onNotify(
      remoteError
        ? "Category deleted locally; Supabase needs its tables"
        : `${category.name} category deleted`,
    );
  };
  const chooseCategoryImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCategoryFile(file);
    void makeLocalImage(file)
      .then(setCategoryImage)
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () => setCategoryImage(String(reader.result));
        reader.readAsDataURL(file);
      });
  };
  const chooseEditCategoryImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEditImageFile(file);
    void makeLocalImage(file)
      .then(setEditImage)
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () => setEditImage(String(reader.result));
        reader.readAsDataURL(file);
      });
  };
  return (
    <section className="panel module-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">CATALOG</p>
          <h2>Categories</h2>
          <p>Keep collections easy to browse with clear category structure.</p>
        </div>
        <div className="module-actions">
          <button
            className="module-secondary"
            onClick={() => onNotify("Category reorder mode opened")}
          >
            Reorder ↗
          </button>
          <button className="module-primary" onClick={() => setIsAdding(true)}>
            + Add category
          </button>
        </div>
      </div>
      {isAdding && (
        <div
          className="product-modal-backdrop"
          onClick={() => setIsAdding(false)}
        >
          <div
            className="product-form-card product-modal-card category-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-category-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close add category form"
              onClick={() => setIsAdding(false)}
            >
              ×
            </button>
            <p className="eyebrow">NEW CATEGORY</p>
            <h3 id="add-category-title">Add a category</h3>
            <div className="product-image-upload category-image-upload">
              <img src={categoryImage} alt="Category card preview" />
              <label>
                <strong>Upload category card image</strong>
                <small>JPG, PNG or WEBP · click to choose</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={chooseCategoryImage}
                />
              </label>
            </div>
            <div className="product-form-grid category-form-grid">
              <label>
                Category name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Anklets"
                />
              </label>
            </div>
            <div className="product-detail-actions">
              <button className="module-primary" onClick={saveCategory}>
                Save category
              </button>
              <button
                className="module-secondary"
                onClick={() => setIsAdding(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live workspace
        </span>
        <span>{categories.length} active categories</span>
      </div>
      <div className="module-list">
        {categories.map((category, index) => (
          <div
            key={`${category.name}-${index}`}
            className={`category-list-row ${selectedCategory?.name === category.name ? "selected" : ""}`}
          >
            <button
              className="category-list-main"
              onClick={() => openCategory(category)}
            >
              <span className="module-row-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{category.name}</strong>
              <small>{category.pieces} pieces</small>
              <b>↗</b>
            </button>
            <div className="product-row-actions">
              <button
                onClick={() => openCategory(category)}
                aria-label={`View ${category.name}`}
                title="View category"
              >
                <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                onClick={() => startEditingCategory(category)}
                aria-label={`Edit ${category.name}`}
                title="Edit category"
              >
                <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                className="delete-action"
                onClick={() => deleteCategory(category)}
                aria-label={`Delete ${category.name}`}
                title="Delete category"
              >
                <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {selectedCategory && isEditing && (
        <div className="product-form-card category-edit-card">
          <p className="eyebrow">EDIT CATEGORY</p>
          <h3>Edit {selectedCategory.name}</h3>
          <div className="product-image-upload category-image-upload">
            <img
              src={
                editImage ||
                defaultCategoryImages[selectedCategory.name] ||
                defaultCategoryImages.Earrings
              }
              alt="Category card preview"
            />
            <label>
              <strong>Upload category card image</strong>
              <small>JPG, PNG or WEBP · click to choose</small>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={chooseEditCategoryImage}
              />
            </label>
          </div>
          <div className="product-form-grid category-form-grid">
            <label>
              Category name
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
          </div>
          <div className="product-detail-actions">
            <button className="module-primary" onClick={saveCategoryEdit}>
              Save changes
            </button>
            <button
              className="module-secondary"
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {selectedCategory && !isEditing && (
        <div className="product-detail-card category-detail-card">
          <div className="product-detail-image">
            <img
              src={
                selectedCategory.image ||
                defaultCategoryImages[selectedCategory.name] ||
                defaultCategoryImages.Earrings
              }
              alt={`${selectedCategory.name} category card`}
            />
          </div>
          <div className="product-detail-copy">
            <p className="eyebrow">CATEGORY DETAILS</p>
            <h3>{selectedCategory.name}</h3>
            <p className="product-detail-meta">Jewellery category</p>
            <div className="product-detail-actions">
              <button
                className="module-primary"
                onClick={() => startEditingCategory(selectedCategory)}
              >
                Edit category
              </button>
              <button
                className="module-secondary"
                onClick={() => setSelectedCategory(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProductLibraryWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [products, setProducts] = useState(adminProducts);
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(
    null,
  );
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    name: "",
    category: "",
    price: "",
    cost: "",
    stock: "",
    sku: "",
    image: "",
    hoverImage: "",
  });
  const [newProductImage, setNewProductImage] = useState(
    adminProducts[0].image,
  );
  const [newProductFile, setNewProductFile] = useState<File | null>(null);
  const [newProductHoverImage, setNewProductHoverImage] = useState(
    adminProducts[0].image,
  );
  const [newProductHoverFile, setNewProductHoverFile] = useState<File | null>(
    null,
  );
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editHoverFile, setEditHoverFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newProduct, setNewProduct] = useState({
    name: "",
    category: "Earrings",
    price: "₹",
    cost: "₹",
    stock: "",
    sku: "",
  });
  useEffect(() => {
    let active = true;
    const loadProducts = async () => {
      const remote = await fetchCatalogProducts();
      if (active && !remote.error && remote.data && remote.data.length) {
        const mapped: AdminProduct[] = remote.data.map((product) => ({
          name: product.name,
          price: `₹${product.price.toLocaleString("en-IN")}`,
          cost: `₹${(product.cost ?? 0).toLocaleString("en-IN")}`,
          sku: product.sku,
          category: product.category,
          stock: product.stock,
          status: product.status,
          image: product.image || adminProducts[0].image,
          hoverImage:
            product.hoverImage || product.image || adminProducts[0].image,
        }));
        let localProducts: AdminProduct[] = [];
        const stored = window.localStorage.getItem("fanzzy-products");
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as Array<
              Omit<Partial<AdminProduct>, "price" | "cost"> & {
                price?: number | string;
                cost?: number | string;
              }
            >;
            if (Array.isArray(parsed)) {
              localProducts = parsed
                .filter(
                  (product) =>
                    typeof product.name === "string" && product.name.trim(),
                )
                .map((product, index) => {
                  const rawPrice = product.price;
                  const rawCost = product.cost;
                  return {
                    name: product.name!.trim(),
                    price:
                      typeof rawPrice === "number"
                        ? `₹${rawPrice.toLocaleString("en-IN")}`
                        : rawPrice || "₹0",
                    cost:
                      typeof rawCost === "number"
                        ? `₹${rawCost.toLocaleString("en-IN")}`
                        : rawCost || "₹0",
                    sku:
                      product.sku ||
                      `FZ-LOCAL-${String(index + 1).padStart(2, "0")}`,
                    category: product.category || "Uncategorised",
                    stock: product.stock ?? 0,
                    status: product.status ?? "Published",
                    image: product.image || adminProducts[0].image,
                    hoverImage:
                      product.hoverImage ||
                      product.image ||
                      adminProducts[0].image,
                  };
                });
            }
          } catch {
            window.localStorage.removeItem("fanzzy-products");
          }
        }
        const merged = new Map(mapped.map((product) => [product.sku, product]));
        localProducts.forEach((product) => merged.set(product.sku, product));
        const nextProducts = Array.from(merged.values());
        setProducts(nextProducts);
        persistCatalog(nextProducts);
        return;
      }
      const stored = window.localStorage.getItem("fanzzy-products");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Array<
          Partial<AdminProduct> & {
            id?: string;
            price?: number | string;
            cost?: number | string;
          }
        >;
        if (active && Array.isArray(parsed) && parsed.length) {
          setProducts(
            parsed
              .filter(
                (product) =>
                  typeof product.name === "string" && product.name.trim(),
              )
              .map((product, index) => {
                const rawPrice = product.price as number | string | undefined;
                const rawCost = product.cost as number | string | undefined;
                return {
                  name: product.name!.trim(),
                  price:
                    typeof rawPrice === "number"
                      ? `₹${rawPrice.toLocaleString("en-IN")}`
                      : rawPrice || "₹0",
                  cost:
                    typeof rawCost === "number"
                      ? `₹${rawCost.toLocaleString("en-IN")}`
                      : rawCost || "₹0",
                  sku:
                    product.sku ||
                    product.id?.toUpperCase() ||
                    `FZ-IMP-${String(index + 1).padStart(2, "0")}`,
                  category: product.category || "Uncategorised",
                  stock: product.stock ?? 0,
                  status: product.status ?? "Published",
                  image: product.image || adminProducts[0].image,
                  hoverImage:
                    product.hoverImage ||
                    product.image ||
                    adminProducts[0].image,
                };
              }),
          );
        }
      } catch {
        window.localStorage.removeItem("fanzzy-products");
      }
    };
    void loadProducts();
    return () => {
      active = false;
    };
  }, []);
  const updateField = (field: keyof typeof newProduct, value: string) =>
    setNewProduct((current) => ({
      ...current,
      [field]: value,
      ...(field === "name"
        ? { sku: createSku(value, current.category, products) }
        : {}),
    }));
  const openAddProduct = () => {
    setNewProduct({
      name: "",
      category: "Earrings",
      price: "₹",
      cost: "₹",
      stock: "",
      sku: "",
    });
    setNewProductImage(adminProducts[0].image);
    setNewProductFile(null);
    setNewProductHoverImage(adminProducts[0].image);
    setNewProductHoverFile(null);
    setSelectedProduct(null);
    setIsEditing(false);
    setIsAdding(true);
  };
  const saveProduct = async () => {
    if (!newProduct.name.trim()) return onNotify("Add a product name");
    const productSku =
      newProduct.sku.trim() ||
      createSku(newProduct.name, newProduct.category, products);
    let productImage = newProductImage;
    let productHoverImage = newProductHoverImage;
    let imageSavedLocally = false;
    if (newProductFile) {
      try {
        productImage = await makeLocalImage(newProductFile);
      } catch {
        /* keep the preview */
      }
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
    if (newProductHoverFile) {
      try {
        productHoverImage = await makeLocalImage(newProductHoverFile);
      } catch {
        /* keep the preview */
      }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(newProductHoverFile, "products");
        if (upload.url && !upload.error) productHoverImage = upload.url;
        else imageSavedLocally = true;
      }
    }
    const product: AdminProduct = {
      name: newProduct.name.trim(),
      sku: productSku,
      category: newProduct.category,
      stock: Number(newProduct.stock) || 0,
      price: newProduct.price.trim() || "₹0",
      cost: newProduct.cost.trim() || "₹0",
      status: Number(newProduct.stock) > 0 ? "Published" : "Draft",
      image: productImage,
      hoverImage: productHoverImage,
    };
    const remoteError = await saveCatalogProduct(toCatalogProduct(product));
    setProducts((current) => {
      const next = [...current, product];
      persistCatalog(next);
      return next;
    });
    setNewProduct({
      name: "",
      category: "Earrings",
      price: "₹",
      cost: "₹",
      stock: "",
      sku: "",
    });
    setNewProductImage(adminProducts[0].image);
    setNewProductFile(null);
    setNewProductHoverImage(adminProducts[0].image);
    setNewProductHoverFile(null);
    setIsAdding(false);
    onNotify(
      remoteError
        ? imageSavedLocally
          ? "Product and image saved locally; Supabase needs setup"
          : "Product saved locally; Supabase needs its tables"
        : imageSavedLocally
          ? "Product added; image saved locally until storage is connected"
          : `${product.name} added to the catalog`,
    );
  };
  const uploadProductImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNewProductFile(file);
    void makeLocalImage(file)
      .then(setNewProductImage)
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () => setNewProductImage(String(reader.result));
        reader.readAsDataURL(file);
      });
  };
  const uploadProductHoverImage = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNewProductHoverFile(file);
    void makeLocalImage(file)
      .then(setNewProductHoverImage)
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () => setNewProductHoverImage(String(reader.result));
        reader.readAsDataURL(file);
      });
  };
  const uploadEditHoverImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEditHoverFile(file);
    void makeLocalImage(file)
      .then((value) =>
        setEditValues((current) => ({ ...current, hoverImage: value })),
      )
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () =>
          setEditValues((current) => ({
            ...current,
            hoverImage: String(reader.result),
          }));
        reader.readAsDataURL(file);
      });
  };
  const uploadEditImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEditImageFile(file);
    void makeLocalImage(file)
      .then((value) =>
        setEditValues((current) => ({ ...current, image: value })),
      )
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () =>
          setEditValues((current) => ({
            ...current,
            image: String(reader.result),
          }));
        reader.readAsDataURL(file);
      });
  };
  const startEditing = (product: AdminProduct) => {
    setSelectedProduct(product);
    setIsAdding(false);
    setIsEditing(true);
    setEditValues({
      name: product.name,
      category: product.category,
      price: product.price,
      cost: product.cost,
      stock: String(product.stock),
      sku: product.sku,
      image: product.image,
      hoverImage: product.hoverImage || product.image,
    });
    setEditImageFile(null);
    setEditHoverFile(null);
  };
  const saveEdit = async () => {
    if (!selectedProduct || !editValues.name.trim())
      return onNotify("Product name is required");
    let image = editValues.image || selectedProduct.image;
    let hoverImage = editValues.hoverImage || selectedProduct.image;
    let remoteImageError = false;
    if (editImageFile) {
      try {
        image = await makeLocalImage(editImageFile);
      } catch {
        /* keep the preview */
      }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(editImageFile, "products");
        if (upload.url && !upload.error) image = upload.url;
        else remoteImageError = true;
      }
    }
    if (editHoverFile) {
      try {
        hoverImage = await makeLocalImage(editHoverFile);
      } catch {
        /* keep the preview */
      }
      if (isSupabaseReady) {
        const upload = await uploadStoreImage(editHoverFile, "products");
        if (upload.url && !upload.error) hoverImage = upload.url;
        else remoteImageError = true;
      }
    }
    const updated: AdminProduct = {
      ...selectedProduct,
      name: editValues.name.trim(),
      category: editValues.category,
      price: editValues.price.trim() || "₹0",
      cost: editValues.cost.trim() || "₹0",
      stock: Number(editValues.stock) || 0,
      sku: editValues.sku.trim() || selectedProduct.sku,
      status: Number(editValues.stock) > 0 ? "Published" : "Draft",
      image,
      hoverImage,
    };
    const remoteError = await saveCatalogProduct(toCatalogProduct(updated));
    if (!remoteError && updated.sku !== selectedProduct.sku)
      await removeCatalogProduct(selectedProduct.sku);
    setProducts((current) => {
      const next = current.map((product) =>
        product.sku === selectedProduct.sku ? updated : product,
      );
      persistCatalog(next);
      return next;
    });
    setSelectedProduct(updated);
    setIsEditing(false);
    onNotify(
      remoteError || remoteImageError
        ? "Product saved locally; Supabase needs its tables"
        : `${updated.name} updated`,
    );
  };
  const deleteProduct = async (product: AdminProduct) => {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    const remoteError = await removeCatalogProduct(product.sku);
    setProducts((current) => {
      const next = current.filter((item) => item.sku !== product.sku);
      persistCatalog(next);
      return next;
    });
    if (selectedProduct?.sku === product.sku) setSelectedProduct(null);
    setIsEditing(false);
    onNotify(
      remoteError
        ? "Product deleted locally; Supabase needs its tables"
        : `${product.name} deleted`,
    );
  };
  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    const headers =
      rows.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
    const findColumn = (aliases: string[]) =>
      headers.findIndex((header) => aliases.includes(header));
    const nameColumn = findColumn(["name", "product", "product name", "title"]);
    const skuColumn = findColumn(["sku", "product sku", "code"]);
    const categoryColumn = findColumn(["category", "type"]);
    const priceColumn = findColumn(["price", "amount"]);
    const costColumn = findColumn([
      "cost",
      "cost price",
      "purchase price",
      "buying price",
    ]);
    const stockColumn = findColumn(["stock", "inventory", "quantity", "qty"]);
    const imported = rows
      .map((row, index): AdminProduct | null => {
        const name = nameColumn >= 0 ? row[nameColumn]?.trim() : "";
        if (!name) return null;
        const stock =
          Number.parseInt(
            stockColumn >= 0 ? (row[stockColumn] ?? "0") : "0",
            10,
          ) || 0;
        return {
          name,
          sku:
            skuColumn >= 0 && row[skuColumn]?.trim()
              ? row[skuColumn].trim()
              : `FZ-IMP-${String(index + 1).padStart(2, "0")}`,
          category:
            categoryColumn >= 0 && row[categoryColumn]?.trim()
              ? row[categoryColumn].trim()
              : "Uncategorised",
          price:
            priceColumn >= 0 && row[priceColumn]?.trim()
              ? row[priceColumn].trim()
              : "₹0",
          cost:
            costColumn >= 0 && row[costColumn]?.trim()
              ? row[costColumn].trim()
              : "₹0",
          stock,
          status: stock > 0 ? "Published" : "Draft",
          image: adminProducts[0].image,
        };
      })
      .filter((product): product is AdminProduct => product !== null);
    if (!imported.length) onNotify("No valid product rows found in CSV");
    else {
      const remoteErrors = await Promise.all(
        imported.map((product) =>
          saveCatalogProduct(toCatalogProduct(product)),
        ),
      );
      setProducts((current) => {
        const next = [...current, ...imported];
        persistCatalog(next);
        return next;
      });
      onNotify(
        remoteErrors.some(Boolean)
          ? "Imported locally; Supabase needs its tables"
          : `${imported.length} product${imported.length === 1 ? "" : "s"} imported`,
      );
    }
    event.target.value = "";
  };
  return (
    <section className="panel module-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">CATALOG</p>
          <h2>Product library</h2>
          <p>
            Create, edit, price, and organise every piece in your storefront.
          </p>
        </div>
        <div className="module-actions">
          <input
            ref={fileInputRef}
            className="csv-file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={importCsv}
          />
          <button
            className="module-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Import CSV ↗
          </button>
          <button className="module-primary" onClick={openAddProduct}>
            + Add product
          </button>
        </div>
      </div>
      {isAdding && (
        <div
          className="product-modal-backdrop"
          onClick={() => setIsAdding(false)}
        >
          <div
            className="product-form-card product-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-product-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="product-modal-close"
              aria-label="Close add product form"
              onClick={() => setIsAdding(false)}
            >
              ×
            </button>
            <p className="eyebrow">NEW PRODUCT</p>
            <h3 id="add-product-title">Add a product</h3>
            <div className="product-image-upload">
              <img src={newProductImage} alt="Product preview" />
              <label>
                <strong>Upload product image</strong>
                <small>JPG, PNG or WEBP · click to choose</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadProductImage}
                />
              </label>
            </div>
            <div className="product-image-upload hover-image-upload">
              <img src={newProductHoverImage} alt="Product hover preview" />
              <label>
                <strong>Upload hover image</strong>
                <small>Shown when customers point at this product</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadProductHoverImage}
                />
              </label>
            </div>
            <div className="product-form-grid">
              <label>
                Product name
                <input
                  value={newProduct.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="e.g. Celeste Hoops"
                />
              </label>
              <label>
                SKU
                <input
                  value={newProduct.sku}
                  onChange={(event) => updateField("sku", event.target.value)}
                  placeholder="FZ-CEL-05"
                />
              </label>
              <label>
                Category
                <select
                  value={newProduct.category}
                  onChange={(event) =>
                    updateField("category", event.target.value)
                  }
                >
                  <option>Earrings</option>
                  <option>Necklaces</option>
                  <option>Bracelets</option>
                  <option>Rings</option>
                </select>
              </label>
                <label>
                  Price
                  <input
                    value={newProduct.price}
                    onChange={(event) => updateField("price", event.target.value)}
                  />
                </label>
                <label>
                  Cost price
                  <input
                    value={newProduct.cost}
                    onChange={(event) => updateField("cost", event.target.value)}
                    placeholder="₹0"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Stock
                <input
                  type="number"
                  min="0"
                  value={newProduct.stock}
                  onChange={(event) => updateField("stock", event.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="product-detail-actions">
              <button className="module-primary" onClick={saveProduct}>
                Save product
              </button>
              <button
                className="module-secondary"
                onClick={() => setIsAdding(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="module-summary">
        <span>
          <i className="status-light" />
          Live workspace
        </span>
        <span>{products.length} active records</span>
      </div>
      <div className="module-list">
        {products.map((product, index) => (
          <div
            key={product.sku}
            className={`product-list-row ${selectedProduct?.sku === product.sku ? "selected" : ""}`}
          >
            <button
              className="product-list-main"
              onClick={() => {
                setSelectedProduct(product);
                setIsAdding(false);
                setIsEditing(false);
                onNotify(`${product.name} opened`);
              }}
            >
              <span className="module-row-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{product.name}</strong>
              <small>
                {product.stock === 0 ? "Draft" : `${product.stock} in stock`} ·{" "}
                {product.category}
              </small>
            </button>
            <div className="product-row-actions">
              <button
                onClick={() => {
                  setSelectedProduct(product);
                  setIsAdding(false);
                  setIsEditing(false);
                  onNotify(`${product.name} opened`);
                }}
                aria-label={`View ${product.name}`}
                title="View product"
              >
                <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                onClick={() => startEditing(product)}
                aria-label={`Edit ${product.name}`}
                title="Edit product"
              >
                <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                className="delete-action"
                onClick={() => deleteProduct(product)}
                aria-label={`Delete ${product.name}`}
                title="Delete product"
              >
                <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {selectedProduct && isEditing && (
        <div className="product-form-card">
          <p className="eyebrow">EDIT PRODUCT</p>
          <h3>Edit {selectedProduct.name}</h3>
          <div className="product-image-upload">
            <img
              src={editValues.image || selectedProduct.image}
              alt="Product main image preview"
            />
            <label>
              <strong>Upload main image</strong>
              <small>Shown as the primary product image</small>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadEditImage}
              />
            </label>
          </div>
          <div className="product-image-upload hover-image-upload">
            <img
              src={editValues.hoverImage || selectedProduct.image}
              alt="Product hover preview"
            />
            <label>
              <strong>Upload hover image</strong>
              <small>Shown when customers point at this product</small>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadEditHoverImage}
              />
            </label>
          </div>
          <div className="product-form-grid">
            <label>
              Product name
              <input
                value={editValues.name}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              SKU
              <input
                value={editValues.sku}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    sku: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Category
              <select
                value={editValues.category}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              >
                <option>Earrings</option>
                <option>Necklaces</option>
                <option>Bracelets</option>
                <option>Rings</option>
              </select>
            </label>
                <label>
                  Price
                  <input
                    value={editValues.price}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    price: event.target.value,
                  }))
                    }
                  />
                </label>
                <label>
                  Cost price
                  <input
                    value={editValues.cost}
                    onChange={(event) =>
                      setEditValues((current) => ({
                        ...current,
                        cost: event.target.value,
                      }))
                    }
                    placeholder="₹0"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Stock
              <input
                type="number"
                min="0"
                value={editValues.stock}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    stock: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="product-detail-actions">
            <button className="module-primary" onClick={saveEdit}>
              Save changes
            </button>
            <button
              className="module-secondary"
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {selectedProduct && !isEditing && (
        <div className="product-detail-card">
          <div className="product-detail-image">
            <img src={selectedProduct.image} alt="" />
          </div>
          <div className="product-detail-copy">
            <p className="eyebrow">PRODUCT DETAILS</p>
            <h3>{selectedProduct.name}</h3>
            <p className="product-detail-meta">
              {selectedProduct.category} · {selectedProduct.sku}
            </p>
            <div className="product-detail-stats">
              <span>
                <small>Price</small>
                <strong>{selectedProduct.price}</strong>
              </span>
              <span>
                <small>Cost price</small>
                <strong>{selectedProduct.cost}</strong>
              </span>
              <span>
                <small>Inventory</small>
                <strong>
                  {selectedProduct.stock === 0
                    ? "Draft"
                    : `${selectedProduct.stock} units`}
                </strong>
              </span>
              <span>
                <small>Status</small>
                <strong>{selectedProduct.status}</strong>
              </span>
            </div>
            <div className="product-detail-actions">
              <button
                className="module-primary"
                onClick={() => startEditing(selectedProduct)}
              >
                Edit product
              </button>
              <button
                className="module-secondary"
                onClick={() => setSelectedProduct(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (inQuotes && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  return rows;
}
