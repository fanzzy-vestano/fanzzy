"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, X } from "lucide-react";
import "../globals.css";
import "./vendor.css";
import { uploadStoreImage } from "../../lib/supabase/catalog";
import { clearVendorSessionToken, saveVendorSessionToken, siteApiFetch, vendorApiFetch } from "../../lib/site-api-client";

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

type VendorDashboardCache = {
  savedAt: number;
  vendorId: string;
  data: Dashboard;
};

const vendorDashboardCacheKey = "fanzzy-vendor-dashboard-cache";
const vendorDashboardCacheMaxAge = 15 * 60 * 1000;
const vendorNavItems = ["Dashboard", "Products", "Add Product", "Inventory", "Categories", "Offers", "Orders", "Sales Reports", "Commission", "Payouts", "Notifications", "Profile", "Bank Details"];

const readVendorDashboardCache = (): VendorDashboardCache | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(vendorDashboardCacheKey);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<VendorDashboardCache>;
    const data = cached.data as Dashboard | undefined;
    if (!cached.vendorId || !cached.savedAt || Date.now() - cached.savedAt > vendorDashboardCacheMaxAge || !data?.vendor || !Array.isArray(data.products) || !Array.isArray(data.orders)) {
      window.sessionStorage.removeItem(vendorDashboardCacheKey);
      return null;
    }
    return cached as VendorDashboardCache;
  } catch {
    window.sessionStorage.removeItem(vendorDashboardCacheKey);
    return null;
  }
};

const writeVendorDashboardCache = (data: Dashboard) => {
  if (typeof window === "undefined") return;
  const vendorId = String((data.vendor as Vendor & { id?: string } | undefined)?.id || "");
  if (!vendorId) return;
  try {
    window.sessionStorage.setItem(vendorDashboardCacheKey, JSON.stringify({ savedAt: Date.now(), vendorId, data } satisfies VendorDashboardCache));
  } catch {
    // A storage limit should never prevent the live dashboard from rendering.
  }
};

const clearVendorDashboardCache = () => {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(vendorDashboardCacheKey);
};

type VendorOrderItem = Record<string, unknown> & {
  product_sku?: string;
  product_name?: string;
  quantity?: number;
  unit_price?: number;
  allocated_discount?: number;
  commission_amount?: number;
  vendor_net_amount?: number;
  product_snapshot?: Record<string, unknown>;
};

type VendorOrder = Record<string, unknown> & {
  gross_product_amount?: number;
  commission_mode?: string;
  commission_rate?: number;
  commission_amount?: number;
  vendor_net_amount?: number;
};

type VendorOrderTracking = {
  fulfillmentMethod?: "delivery" | "pickup";
  pickupHubName?: string;
  pickupHubPlace?: string;
  waybill?: string;
  trackingUrl?: string;
  shipmentStatus?: string;
  shipmentError?: string;
  shipmentCreatedAt?: string;
  pickupRequestStatus?: string;
  pickupRequestId?: string;
  pickupRequestDate?: string;
  pickupRequestTime?: string;
  liveStatus?: string;
  liveStatusType?: string;
  liveStatusDate?: string;
  liveLocation?: string;
  lastTrackedAt?: string;
  scans: Array<{ status: string; date?: string; location?: string; instructions?: string }>;
};

type VendorOrderDetails = {
  order: VendorOrder;
  items: VendorOrderItem[];
  tracking: VendorOrderTracking;
};

type ProductVariantType = "normal" | "size";
type VendorProductVariant = { name: string; size?: string; image: string; stock?: number };
type VendorProductForm = {
  name: string;
  sku: string;
  category: string;
  price: string;
  cost: string;
  stock: string;
  barcode: string;
  hsnCode: string;
  billName: string;
  gstRate: string;
  markup: string;
  costWithGst: string;
  sizes: string;
  sizeStock: Record<string, number | "">;
  variantType: ProductVariantType;
  variants: VendorProductVariant[];
  image: string;
  hoverImage: string;
  description: string;
};

const emptyProductForm = (): VendorProductForm => ({
  name: "",
  sku: "",
  category: "Uncategorised",
  price: "₹",
  cost: "₹",
  stock: "",
  barcode: "",
  hsnCode: "",
  billName: "",
  gstRate: "",
  markup: "",
  costWithGst: "₹",
  sizes: "",
  sizeStock: {},
  variantType: "normal",
  variants: [],
  image: "",
  hoverImage: "",
  description: "",
});

const parseProductNumber = (value: string) => Number(value.replace(/[^0-9.]/g, "")) || 0;
const formatProductMoney = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return `₹${rounded.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const calculateProductPricing = (costValue: string, gstValue: string, markupValue: string) => {
  const cost = parseProductNumber(costValue);
  const costWithGst = cost > 0 ? cost * (1 + (Number(gstValue) || 0) / 100) : 0;
  return {
    costWithGst: costWithGst > 0 ? formatProductMoney(costWithGst) : "₹",
    price: costWithGst > 0 ? formatProductMoney(costWithGst * (1 + (Number(markupValue) || 0) / 100)) : "₹",
  };
};
const calculateProductMarkup = (costValue: string, gstValue: string, priceValue: string) => {
  const costWithGst = parseProductNumber(costValue) * (1 + (Number(gstValue) || 0) / 100);
  const price = parseProductNumber(priceValue);
  return costWithGst > 0 && price > 0 ? String(Math.round(((price / costWithGst - 1) * 100) * 100) / 100) : "";
};
const parseProductSizes = (value: string) => Array.from(new Set(value.split(",").map((size) => size.trim()).filter(Boolean)));

const money = (value: unknown) => `₹${(Number(value) || 0).toLocaleString("en-IN")}`;
const trackingStages = [
  { key: "ready", label: "Ready to ship", match: /manifest|ready|shipment created|confirmed/i },
  { key: "pickup", label: "Scheduled for pickup", match: /pickup|schedule|booked/i },
  { key: "transit", label: "In-transit", match: /transit|dispatched|picked|shipped|reached destination/i },
  { key: "out-for-delivery", label: "Out for delivery", match: /out for delivery|out-for-delivery/i },
  { key: "delivered", label: "Delivered", match: /delivered|successfully delivered/i },
] as const;
const trackingStageIndex = (status: string) => {
  const normalized = status.toLowerCase();
  if (/delivered|successfully delivered/.test(normalized)) return 4;
  if (/out for delivery|out-for-delivery/.test(normalized)) return 3;
  if (/transit|dispatched|picked|shipped|reached destination/.test(normalized)) return 2;
  if (/pickup|schedule|booked/.test(normalized)) return 1;
  return 0;
};
const trackingDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};
const vendorTrackingUrl = (waybill?: string, storedUrl?: string) => storedUrl
  || (waybill ? `https://www.delhivery.com/tracking?uniqueIdentifier=${encodeURIComponent(waybill)}` : "");

const makeLocalImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
  reader.onload = () => {
    const image = new window.Image();
    image.onerror = () => reject(new Error("Could not process image"));
    image.onload = () => {
      const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/webp", 0.78));
    };
    image.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});

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
      const response = await siteApiFetch("/vendor-auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { error?: string; sessionToken?: string };
      if (!response.ok) throw new Error(body.error || "Could not sign in");
      if (!body.sessionToken) throw new Error("The vendor session could not be created.");
      clearVendorDashboardCache();
      saveVendorSessionToken(body.sessionToken);
      onSuccess();
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : "Could not sign in");
    } finally {
      setLoading(false);
    }
  };

  return <main className="vendor-login-page"><a href="/" className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a><form className="vendor-login-card" onSubmit={submit}><p className="eyebrow">VENDOR PORTAL</p><h1>Welcome back.</h1><p>Sign in with the email and password provided by the Fanzzy admin team.</p><label>Login email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{(loginError || error) && <p className="vendor-error" role="alert">{loginError || error}</p>}<button className="button button-dark full-width" disabled={loading}>{loading ? "Signing in…" : "Sign in"} <span>↗</span></button><small>No email verification, OTP, or password-reset email is used. Contact admin if you need access.</small></form></main>;
}

function VendorPortalLoadingShell() {
  return <main className="vendor-portal vendor-portal-loading" aria-busy="true" aria-label="Loading vendor portal">
    <aside className="vendor-sidebar">
      <span className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></span>
      <span className="vendor-loading-name" />
      <div className="vendor-loading-nav" aria-hidden="true">{vendorNavItems.map((item) => <span key={item}>{item}</span>)}</div>
    </aside>
    <section className="vendor-portal-content">
      <header className="vendor-portal-header"><div><p className="eyebrow">VENDOR DASHBOARD</p><h1>Dashboard</h1></div><span className="vendor-loading-status">Checking session</span></header>
      <div className="vendor-stat-grid vendor-loading-stats" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <article key={index}><span /><strong /></article>)}</div>
      <section className="vendor-data-card vendor-loading-card" aria-hidden="true"><span /><span /><span /></section>
    </section>
  </main>;
}

export default function VendorDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [tab, setTab] = useState("Dashboard");
  const [form, setForm] = useState<VendorProductForm>(emptyProductForm);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [imageFileName, setImageFileName] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [hoverImageFileName, setHoverImageFileName] = useState("");
  const [hoverImageFile, setHoverImageFile] = useState<File | null>(null);
  const hoverImageInputRef = useRef<HTMLInputElement>(null);
  const variantImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [categoryName, setCategoryName] = useState("");
  const [categoryImage, setCategoryImage] = useState("");
  const [categoryFile, setCategoryFile] = useState<File | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const [editingCategory, setEditingCategory] = useState("");
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<VendorOrderDetails | null>(null);
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);
  const [orderDetailsError, setOrderDetailsError] = useState("");
  const load = async (useVerifiedCache = false) => {
    setDashboardLoading(true);
    let freshDashboardSettled = false;
    const cached = useVerifiedCache ? readVendorDashboardCache() : null;
    if (cached) {
      void vendorApiFetch("/vendor-auth/session", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok || freshDashboardSettled) return;
          const body = await response.json() as { authenticated?: boolean; vendor?: { id?: string } };
          if (body.authenticated && body.vendor?.id === cached.vendorId && !freshDashboardSettled) {
            setData(cached.data);
            setError("");
          }
        })
        .catch(() => undefined);
    }
    try {
      const response = await vendorApiFetch("/vendor/dashboard", { cache: "no-store" });
      const body = await response.json() as Dashboard & { error?: string };
      if (response.status === 401) {
        freshDashboardSettled = true;
        clearVendorDashboardCache();
        clearVendorSessionToken();
        setData(null);
        setError("");
        return;
      }
      if (!response.ok) throw new Error(body.error || "Could not load dashboard.");
      freshDashboardSettled = true;
      setError("");
      setData(body);
      writeVendorDashboardCache(body);
    } catch (caught) {
      freshDashboardSettled = true;
      setError(caught instanceof Error ? caught.message : "Could not load dashboard.");
    } finally {
      setDashboardLoading(false);
    }
  };

  // Loading the remote vendor session is the intended external synchronization.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(true); }, []);

  useEffect(() => {
    if (!editingSku) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editingSku]);

  useEffect(() => {
    if (!selectedOrderDetails && !orderDetailsLoading) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [selectedOrderDetails, orderDetailsLoading]);

  const updateFormField = (field: keyof VendorProductForm, value: string) => setForm((current) => {
    const next = { ...current, [field]: value } as VendorProductForm;
    if (field === "cost" || field === "gstRate" || field === "markup") {
      const pricing = calculateProductPricing(next.cost, next.gstRate, next.markup);
      next.costWithGst = pricing.costWithGst;
      if (parseProductNumber(next.cost) > 0) next.price = pricing.price;
    }
    if (field === "price") next.markup = calculateProductMarkup(next.cost, next.gstRate, next.price);
    return next;
  });

  const updateProductSizes = (value: string) => setForm((current) => {
    const sizes = parseProductSizes(value);
    return { ...current, sizes: value, sizeStock: Object.fromEntries(sizes.map((size) => [size, current.sizeStock[size] ?? ""])) };
  });

  const updateVariant = (index: number, field: "name" | "size" | "stock", value: string) => setForm((current) => ({
    ...current,
    variants: current.variants.map((variant, variantIndex) => variantIndex === index
      ? { ...variant, [field]: field === "stock" ? (value === "" ? undefined : Math.max(0, Number(value) || 0)) : value }
      : variant),
  }));

  const addVariant = () => setForm((current) => ({
    ...current,
    variants: [...current.variants, { name: "", ...(current.variantType === "size" ? { size: "" } : {}), image: "" }],
  }));

  const removeVariant = (index: number) => setForm((current) => ({
    ...current,
    variants: current.variants.filter((_, variantIndex) => variantIndex !== index),
  }));

  const uploadVariantImage = async (index: number, file: File) => {
    setImageUploading(true);
    try {
      let image = await makeLocalImage(file);
      const upload = await uploadStoreImage(file, "products");
      if (upload.url && !upload.error) image = upload.url;
      setForm((current) => ({
        ...current,
        variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, image } : variant),
      }));
    } catch {
      setMessage("Could not upload this variant image.");
    } finally {
      setImageUploading(false);
    }
  };

  const resetProductEditor = () => {
    setForm(emptyProductForm());
    setEditingSku(null);
    setImageFileName("");
    setImageFile(null);
    setHoverImageFileName("");
    setHoverImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (hoverImageInputRef.current) hoverImageInputRef.current.value = "";
    Object.keys(variantImageInputRefs.current).forEach((key) => {
      const input = variantImageInputRefs.current[Number(key)];
      if (input) input.value = "";
    });
    variantImageInputRefs.current = {};
  };

  const closeProductEditor = () => {
    resetProductEditor();
    setMessage("");
    setTab("Products");
  };

  const startEditingProduct = (product: Record<string, unknown>) => {
    const variants = Array.isArray(product.variants)
      ? product.variants
        .filter((variant): variant is Record<string, unknown> => Boolean(variant && typeof variant === "object" && !Array.isArray(variant)))
        .map((variant) => {
          const stock = variant.stock === undefined || variant.stock === "" ? undefined : Number(variant.stock);
          return {
            name: String(variant.name || ""),
            ...(variant.size ? { size: String(variant.size) } : {}),
            image: String(variant.image || ""),
            ...(stock === undefined || !Number.isFinite(stock) ? {} : { stock }),
          };
        })
      : [];
    const sizeStock = product.sizeStock && typeof product.sizeStock === "object" && !Array.isArray(product.sizeStock)
      ? Object.fromEntries(Object.entries(product.sizeStock as Record<string, unknown>).map(([size, stock]) => [size, Number(stock) || 0]))
      : {};
    const price = Number(product.price || 0);
    const cost = Number(product.cost || 0);
    setForm({
      ...emptyProductForm(),
      name: String(product.name || ""),
      sku: String(product.sku || ""),
      category: String(product.category || "Uncategorised"),
      price: price > 0 ? formatProductMoney(price) : "₹",
      cost: cost > 0 ? formatProductMoney(cost) : "₹",
      stock: String(product.stock ?? ""),
      barcode: String(product.barcode || ""),
      hsnCode: String(product.hsnCode || ""),
      billName: String(product.billName || ""),
      gstRate: String(product.gstRate ?? ""),
      markup: String(product.markup ?? ""),
      costWithGst: String(product.costWithGst || "₹"),
      sizes: Array.isArray(product.sizes) ? product.sizes.map(String).join(", ") : "",
      sizeStock,
      variantType: product.variantType === "size" ? "size" : "normal",
      variants,
      image: String(product.image || ""),
      hoverImage: String(product.hover_image || product.image || ""),
      description: String(product.description || ""),
    });
    setEditingSku(String(product.sku || ""));
    setImageFile(null);
    setImageFileName("");
    setHoverImageFile(null);
    setHoverImageFileName("");
    setMessage("");
    setTab("Products");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (imageUploading) return;
    if (!form.name.trim()) return setMessage("Add a product name.");
    setImageUploading(true);
    try {
      let image = form.image;
      let hoverImage = form.hoverImage || form.image;
      if (imageFile) {
        const upload = await uploadStoreImage(imageFile, "products");
        if (upload.url && !upload.error) image = upload.url;
      }
      if (hoverImageFile) {
        const upload = await uploadStoreImage(hoverImageFile, "products");
        if (upload.url && !upload.error) hoverImage = upload.url;
      }
      const sizes = form.variantType === "size" && form.variants.length
        ? Array.from(new Set(form.variants.map((variant) => (variant.size || variant.name).trim()).filter(Boolean)))
        : parseProductSizes(form.sizes);
      const sizeStock = form.variantType === "size" && form.variants.length
        ? Object.fromEntries(form.variants.map((variant) => [(variant.size || variant.name).trim(), variant.stock ?? ""]).filter(([size]) => Boolean(size)))
        : form.sizeStock;
      const payload = {
        ...form,
        image,
        hover_image: hoverImage,
        vendor_status: "Pending Approval",
        price: parseProductNumber(form.price),
        cost: parseProductNumber(form.cost),
        stock: form.variants.length ? 0 : Math.max(0, Math.floor(Number(form.stock) || 0)),
        sizes,
        sizeStock,
        variants: form.variants,
        variantType: form.variantType,
      };
      const response = await vendorApiFetch(editingSku ? `/vendor/products/${encodeURIComponent(editingSku)}` : "/vendor/products", { method: editingSku ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string; product?: { vendor_status?: string } };
      const approvedAutomatically = body.product?.vendor_status === "Approved";
      const successMessage = approvedAutomatically
        ? (editingSku ? "Product updated and published automatically." : "Product submitted and published automatically.")
        : (editingSku ? "Product updated and sent for admin approval." : "Product submitted for admin approval.");
      setMessage(response.ok ? successMessage : body.error || (editingSku ? "Could not update product." : "Could not submit product."));
      if (response.ok) {
        resetProductEditor();
        if (editingSku) setTab("Products");
        void load();
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : editingSku ? "Could not update product." : "Could not submit product.");
    } finally {
      setImageUploading(false);
    }
  };

  const chooseProductImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Please choose a valid image file."); event.currentTarget.value = ""; return; }
    setImageUploading(true);
    setMessage("Preparing image…");
    try {
      const image = await makeLocalImage(file);
      setForm((current) => ({ ...current, image }));
      setImageFileName(file.name);
      setImageFile(file);
      setMessage("Image ready. It will be uploaded when you submit the product.");
    } catch {
      setMessage("Could not read this image. Please choose another file.");
      event.currentTarget.value = "";
    } finally {
      setImageUploading(false);
    }
  };

  const chooseHoverImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Please choose a valid image file."); event.currentTarget.value = ""; return; }
    setImageUploading(true);
    try {
      const image = await makeLocalImage(file);
      setForm((current) => ({ ...current, hoverImage: image }));
      setHoverImageFileName(file.name);
      setHoverImageFile(file);
      setMessage("Hover image ready. It will be uploaded when you submit the product.");
    } catch {
      setMessage("Could not read this image. Please choose another file.");
      event.currentTarget.value = "";
    } finally {
      setImageUploading(false);
    }
  };

  const chooseCategoryImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Please choose a valid image file."); event.currentTarget.value = ""; return; }
    try {
      setCategoryImage(await makeLocalImage(file));
      setCategoryFile(file);
      setMessage("Category image ready.");
    } catch {
      setMessage("Could not read this image. Please choose another file.");
      event.currentTarget.value = "";
    }
  };

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) return setMessage("Enter a category name.");
    const previousName = editingCategory.trim();
    if ((data?.categories || []).some((category) => category.toLowerCase() === name.toLowerCase() && category.toLowerCase() !== previousName.toLowerCase())) return setMessage("This category already exists.");
    setCategorySaving(true);
    setMessage("");
    try {
      let image = categoryImage;
      if (categoryFile) {
        const upload = await uploadStoreImage(categoryFile, "categories");
        if (upload.url && !upload.error) image = upload.url;
      }
      const response = await vendorApiFetch("/vendor/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, previousName, image }),
      });
      const body = await response.json() as { error?: string; categories?: string[] };
      if (!response.ok) throw new Error(body.error || "Could not save category.");
      setCategoryName("");
      setCategoryImage("");
      setCategoryFile(null);
      setEditingCategory("");
      if (categoryInputRef.current) categoryInputRef.current.value = "";
      setMessage(previousName ? `${name} category updated.` : `${name} category added.`);
      setTab("Categories");
      void load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not add category.");
    } finally {
      setCategorySaving(false);
    }
  };

  const editCategory = (category: string) => {
    setEditingCategory(category);
    setCategoryName(category);
    setCategoryImage("");
    setCategoryFile(null);
    setMessage("");
    setTab("Add Category");
  };

  const deleteCategory = async (category: string) => {
    const usageCount = (data?.products || []).filter((product) => String(product.category || "").toLowerCase() === category.toLowerCase()).length;
    const usageNote = usageCount ? ` ${usageCount} product${usageCount === 1 ? "" : "s"} will keep the current category label.` : "";
    if (!window.confirm(`Delete ${category}? This removes it from the category list.${usageNote}`)) return;
    setCategorySaving(true);
    setMessage("");
    try {
      const response = await vendorApiFetch("/vendor/categories", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: category }),
      });
      const body = await response.json() as { error?: string; categories?: string[] };
      if (!response.ok) throw new Error(body.error || "Could not delete category.");
      if (editingCategory.toLowerCase() === category.toLowerCase()) {
        setEditingCategory("");
        setCategoryName("");
      }
      setMessage(`${category} category deleted.`);
      void load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not delete category.");
    } finally {
      setCategorySaving(false);
    }
  };

  const resetCategoryEditor = () => {
    setEditingCategory("");
    setCategoryName("");
    setCategoryImage("");
    setCategoryFile(null);
    if (categoryInputRef.current) categoryInputRef.current.value = "";
  };

  const openAddCategory = () => {
    resetCategoryEditor();
    setMessage("");
    setTab("Add Category");
  };

  const closeCategoryEditor = () => {
    resetCategoryEditor();
    setMessage("");
    setTab("Categories");
  };

  const categoryChips = (categories: string[]) => <div className="vendor-chip-list">{categories.map((category) => <div className="vendor-chip" key={category}><span>{category}</span><span className="vendor-category-actions"><button type="button" className="vendor-category-edit" onClick={() => editCategory(category)} disabled={categorySaving}>Edit</button><button type="button" className="vendor-category-delete" onClick={() => void deleteCategory(category)} disabled={categorySaving}>Delete</button></span></div>)}</div>;

  const deleteProduct = async (sku: string, name: string) => {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    const response = await vendorApiFetch(`/vendor/products/${encodeURIComponent(sku)}`, { method: "DELETE" });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? `${name} deleted.` : body.error || "Could not delete product.");
    if (response.ok) void load();
  };

  const viewOrder = async (orderId: string) => {
    setOrderDetailsLoading(true);
    setOrderDetailsError("");
    const cachedOrder = data?.orders.find((order) => String(order.id) === orderId);
    setSelectedOrderDetails(cachedOrder
      ? { order: cachedOrder as VendorOrder, items: [], tracking: { scans: [] } }
      : null);
    try {
      const response = await vendorApiFetch(`/vendor/orders/${encodeURIComponent(orderId)}/tracking`, { cache: "no-store" });
      const body = await response.json() as VendorOrderDetails & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load order details.");
      setSelectedOrderDetails(body);
    } catch (caught) {
      setOrderDetailsError(caught instanceof Error ? caught.message : "Could not load order details.");
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const closeOrderDetails = () => {
    setSelectedOrderDetails(null);
    setOrderDetailsError("");
    setOrderDetailsLoading(false);
  };

  const logout = async () => { await vendorApiFetch("/vendor-auth/logout", { method: "POST" }).catch(() => undefined); clearVendorDashboardCache(); clearVendorSessionToken(); window.location.assign("/vendor"); };

  if (dashboardLoading && !data) return <VendorPortalLoadingShell />;
  if (!data) return <VendorLogin error={error} onSuccess={() => { setDashboardLoading(true); void load(); }} />;

  const stats = data.stats || {};
  const statItems: Array<[string, unknown]> = [["Today’s sales", stats.grossSales], ["Net earnings", stats.netEarnings], ["Admin commission", stats.commission], ["Total orders", stats.totalOrders], ["New orders", stats.newOrders], ["Delivered", stats.deliveredOrders], ["Active products", stats.activeProducts], ["Low stock", stats.lowStockProducts], ["Out of stock", stats.outOfStockProducts]];
  const isMoney = (label: string) => /sales|earnings|commission/i.test(label);
  const showProductEditor = tab === "Add Product" || (editingSku !== null && (tab === "Products" || tab === "Inventory"));
  const payoutCompleteStatuses = new Set(["Paid", "Approved", "Processing", "Pending"]);
  const payoutEligibleOrders = data.orders.filter((order) => String(order.status) === "Delivered" && !payoutCompleteStatuses.has(String(order.payout_status || "")));
  const availablePayout = payoutEligibleOrders.reduce((sum, order) => sum + (Number(order.vendor_net_amount) || 0), 0);
  const totalPayouts = data.payouts.reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0);
  const paidPayouts = data.payouts.filter((payout) => String(payout.status) === "Paid").reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0);
  const displayedOrders = tab === "Returns"
    ? data.orders.filter((order) => /return|refund/i.test(String(order.status || "")))
    : data.orders;
  const selectedTracking = selectedOrderDetails?.tracking;
  const selectedCustomer = selectedOrderDetails?.order.customer_snapshot && typeof selectedOrderDetails.order.customer_snapshot === "object"
    ? selectedOrderDetails.order.customer_snapshot as Record<string, unknown>
    : {};

  return <main className="vendor-portal"><aside className="vendor-sidebar"><a href="/" className="wordmark"><img src="/fanzzy-mark.png" alt="Fanzzy" className="brand-logo" /></a><p className="vendor-sidebar-name">{data.vendor?.business_name}</p>{vendorNavItems.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => { if (item === "Add Product" && editingSku) closeProductEditor(); setTab(item); }}>{item}</button>)}<button onClick={() => void logout()}>Logout ↪</button></aside><section className="vendor-portal-content"><header className="vendor-portal-header"><div><p className="eyebrow">VENDOR DASHBOARD</p><h1>{tab}</h1></div><div className="vendor-portal-header-status">{dashboardLoading && <span className="vendor-refreshing" role="status">Refreshing</span>}<span className="vendor-status">{data.vendor?.status}</span></div></header>
    {showProductEditor && <div className={editingSku ? "vendor-edit-modal-backdrop" : "vendor-edit-form-shell"} role={editingSku ? "dialog" : undefined} aria-modal={editingSku ? true : undefined} aria-label={editingSku ? `Edit ${form.name || "product"}` : undefined}>
      <div className={editingSku ? "vendor-edit-modal" : undefined}>
        {editingSku && <button className="vendor-edit-modal-close" type="button" onClick={closeProductEditor} aria-label="Close edit product">×</button>}
        <form className="vendor-form-card vendor-product-form vendor-product-edit-card" onSubmit={saveProduct}>
      <h2>{editingSku ? "Edit product" : "Submit a product"}</h2>
      <p>{editingSku ? "Update the product details. Changes stay hidden until an admin approves them again." : "Use the same product details as Admin. New vendor products stay hidden until an admin approves them."}</p>
      <div className="vendor-product-image-grid">
        <label className="vendor-image-upload-field"><strong>Product image</strong><input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseProductImage(event)} /><small>{imageFileName || "JPG, PNG or WebP · primary image"}</small></label>
        <label className="vendor-image-upload-field"><strong>Hover image</strong><input ref={hoverImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseHoverImage(event)} /><small>{hoverImageFileName || "Shown when customers point at the product"}</small></label>
        {form.image && <div className="vendor-image-preview"><img src={form.image} alt="Product preview" /><button type="button" onClick={() => { setForm((current) => ({ ...current, image: "" })); setImageFileName(""); setImageFile(null); if (imageInputRef.current) imageInputRef.current.value = ""; }}>Remove main image</button></div>}
        {form.hoverImage && <div className="vendor-image-preview"><img src={form.hoverImage} alt="Hover preview" /><button type="button" onClick={() => { setForm((current) => ({ ...current, hoverImage: "" })); setHoverImageFileName(""); setHoverImageFile(null); if (hoverImageInputRef.current) hoverImageInputRef.current.value = ""; }}>Remove hover image</button></div>}
      </div>
      <div className="vendor-product-form-grid">
        <label>Product name<input value={form.name} onChange={(event) => updateFormField("name", event.target.value)} placeholder="e.g. Celeste Hoops" required /></label>
        <label>Bill name<input value={form.billName} onChange={(event) => updateFormField("billName", event.target.value)} placeholder="Name shown on customer bill" /></label>
        <label>SKU <span className="vendor-field-note">Auto-generated</span><input value={form.sku || "Auto-generated"} readOnly aria-readonly="true" /></label>
        <label>Barcode<input value={form.barcode} onChange={(event) => updateFormField("barcode", event.target.value)} placeholder="Scan or enter barcode" inputMode="numeric" /></label>
        <label>HSN code<input value={form.hsnCode} onChange={(event) => updateFormField("hsnCode", event.target.value)} placeholder="e.g. 7117" inputMode="numeric" /></label>
        <label>Category<select value={form.category} onChange={(event) => { if (event.target.value === "__add_new__") { setMessage(""); setTab("Add Category"); return; } updateFormField("category", event.target.value); }}><option value="Uncategorised">Uncategorised</option>{(data.categories || []).map((category) => <option value={category} key={category}>{category}</option>)}<option value="__add_new__">+ Add new category</option></select></label>
        <label>Cost price<input value={form.cost} onChange={(event) => updateFormField("cost", event.target.value)} placeholder="₹0" inputMode="decimal" /></label>
        <label>GST %<input type="number" min="0" step="0.01" value={form.gstRate} onChange={(event) => updateFormField("gstRate", event.target.value)} placeholder="e.g. 5" /></label>
        <label>Cost incl. GST<input value={form.costWithGst} readOnly aria-label="Cost including GST" /></label>
        <label>Markup %<input type="number" min="0" step="0.01" value={form.markup} onChange={(event) => updateFormField("markup", event.target.value)} placeholder="e.g. 25" /></label>
        <label>Selling price<input value={form.price} onChange={(event) => updateFormField("price", event.target.value)} placeholder="Calculated from cost + markup" required /></label>
        {!form.variants.length && <label>Stock<input type="number" min="0" value={form.stock} onChange={(event) => updateFormField("stock", event.target.value)} placeholder="0" required /></label>}
      </div>
      <div className="vendor-variant-type"><label>Stock tracking method<select value={form.variantType} onChange={(event) => setForm((current) => ({ ...current, variantType: event.target.value as ProductVariantType }))}><option value="normal">VARIANT STOCK — colour / model wise</option><option value="size">SIZE STOCK — add size variants</option></select><small>Normal variants reduce selected variant stock. Size variants reduce selected size stock.</small></label></div>
      <div className="vendor-variant-editor">
        <div className="vendor-variant-heading"><div><p className="eyebrow">{form.variantType === "size" ? "SIZE VARIANTS" : "COLOUR / SERIES / MODEL VARIANTS"}</p><small>{form.variantType === "size" ? "Add each size with its own stock and image." : "Add a separate customer-selectable image and stock for each variant."}</small></div><button className="button vendor-variant-add" type="button" onClick={addVariant}>{form.variantType === "size" ? "+ Add size variant" : "+ Add variant"}</button></div>
        {form.variants.length ? <div className="vendor-variant-list">{form.variants.map((variant, index) => <div className="vendor-variant-row" key={`vendor-variant-${index}`}><label>Variant name<input value={variant.name} onChange={(event) => updateVariant(index, "name", event.target.value)} placeholder={form.variantType === "size" ? "e.g. Classic" : "e.g. Rose gold"} /></label>{form.variantType === "size" && <label>Size<input value={variant.size || ""} onChange={(event) => updateVariant(index, "size", event.target.value)} placeholder="e.g. 6" /></label>}<label>{form.variantType === "size" ? "Size stock" : "Variant stock"}<input type="number" min="0" value={variant.stock ?? ""} onChange={(event) => updateVariant(index, "stock", event.target.value)} placeholder="0" /></label><label className="vendor-image-upload-field">Variant image<input ref={(element) => { variantImageInputRefs.current[index] = element; }} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVariantImage(index, file); }} /><small>{variant.image ? "Image selected" : "JPG, PNG or WebP"}</small></label>{variant.image && <img className="vendor-variant-preview" src={variant.image} alt="Variant preview" />}<button className="vendor-variant-remove" type="button" onClick={() => removeVariant(index)} aria-label={`Remove variant ${index + 1}`}>×</button></div>)}</div> : <p className="vendor-variant-empty">No variants added yet. Add variants only when this product has colour, model, or size-level stock.</p>}
      </div>
      {form.variantType === "size" && !form.variants.length && <div className="vendor-size-stock"><label>Available sizes<input value={form.sizes} onChange={(event) => updateProductSizes(event.target.value)} placeholder="e.g. 6, 7, 8" /><small>Separate multiple sizes with commas.</small></label>{parseProductSizes(form.sizes).length > 0 && <div className="vendor-size-stock-grid">{parseProductSizes(form.sizes).map((size) => <label key={size}>{size}<input type="number" min="0" value={form.sizeStock[size] ?? ""} onChange={(event) => setForm((current) => ({ ...current, sizeStock: { ...current.sizeStock, [size]: event.target.value === "" ? "" : Number(event.target.value) } }))} placeholder="Quantity" /></label>)}</div>}</div>}
      <label className="vendor-form-wide">Description<textarea value={form.description} onChange={(event) => updateFormField("description", event.target.value)} placeholder="Describe the product for admin review" /></label>
      {message && <p className="vendor-message">{message}</p>}
      <div className="vendor-product-form-actions"><button className="button button-dark" disabled={imageUploading}>{imageUploading ? "Saving product…" : editingSku ? "Save changes" : "Submit for approval"} <span>↗</span></button>{editingSku && <button className="button vendor-category-cancel" type="button" onClick={closeProductEditor}>Cancel editing</button>}</div>
        </form>
      </div>
    </div>}
    {(tab === "Categories" || tab === "Add Category") && <section className="vendor-data-card vendor-category-workspace"><div className="vendor-category-heading"><div><h2>{tab === "Add Category" ? editingCategory ? "Edit category" : "Add a category" : "Your product categories"}</h2><p>{tab === "Add Category" ? editingCategory ? `Update ${editingCategory} for your vendor products.` : "Create a category for your vendor products." : "Only categories created for your vendor account appear here."}</p></div>{tab === "Categories" && <button className="button button-dark" type="button" onClick={openAddCategory}>+ Add category <span>↗</span></button>}</div>{tab === "Add Category" && <div className="vendor-category-list"><p className="eyebrow">YOUR CATEGORIES</p>{categoryChips(data.categories || [])}{!data.categories?.length && <p className="muted">No categories have been added for this vendor yet.</p>}</div>}{tab === "Add Category" ? <form className="vendor-category-form" onSubmit={saveCategory}><label>Category name<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Example: Pendant Sets" required /></label><label className="vendor-image-upload-field">Category image<input ref={categoryInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseCategoryImage(event)} /><small>Optional · PNG, JPG or WebP</small></label>{categoryImage && <div className="vendor-image-preview"><img src={categoryImage} alt="Category preview" /><button type="button" onClick={() => { setCategoryImage(""); setCategoryFile(null); if (categoryInputRef.current) categoryInputRef.current.value = ""; }}>Remove image</button></div>}<div className="vendor-category-form-actions"><button className="button button-dark" type="submit" disabled={categorySaving}>{categorySaving ? "Saving…" : editingCategory ? "Update category" : "Save category"} <span>↗</span></button><button className="button vendor-category-cancel" type="button" onClick={closeCategoryEditor}>Cancel</button></div></form> : <>{categoryChips(data.categories || [])}{!data.categories?.length && <p className="muted">No categories have been added for this vendor yet.</p>}</>}{message && <p className="vendor-message">{message}</p>}</section>}
    {tab === "Offers" && <section className="vendor-data-card"><h2>Current store offers</h2>{(data.offers || []).map((offer, index) => <div className="vendor-data-row" key={String(offer.id || offer.code || index)}><span><strong>{String(offer.name || offer.title || offer.code || "Offer")}</strong><small>{String(offer.description || offer.detail || offer.status || "Configured by admin")}</small></span></div>)}{!data.offers?.length && <p className="muted">No active offers are available right now.</p>}</section>}
    {tab === "Profile" && <section className="vendor-data-card vendor-details-card vendor-profile-card"><div className="vendor-profile-heading"><div className="vendor-profile-avatar">{(data.vendor?.business_name || "V").slice(0, 1).toUpperCase()}</div><div><p className="eyebrow">ACCOUNT PROFILE</p><h2>{data.vendor?.business_name || "Vendor profile"}</h2><span className="vendor-profile-status">{data.vendor?.status || "Active"}</span></div></div><div className="vendor-profile-grid"><div><span>Owner</span><strong>{data.vendor?.owner_name || "—"}</strong></div><div><span>Login email</span><strong>{data.vendor?.login_email || "—"}</strong></div><div><span>Phone</span><strong>{data.vendor?.phone || "—"}</strong></div><div><span>WhatsApp</span><strong>{data.vendor?.whatsapp || "—"}</strong></div><div className="vendor-profile-field-wide"><span>Address</span><strong>{[data.vendor?.address, data.vendor?.city, data.vendor?.state, data.vendor?.pin_code].filter(Boolean).join(", ") || "—"}</strong></div><div><span>GST number</span><strong>{data.vendor?.gst_number || "—"}</strong></div><div><span>PAN number</span><strong>{data.vendor?.pan_number || "—"}</strong></div></div></section>}
    {tab !== "Add Product" && tab !== "Categories" && tab !== "Add Category" && tab !== "Offers" && tab !== "Profile" && <><div className="vendor-stat-grid">{statItems.map(([label, value]) => <article key={label}><small>{label}</small><strong>{isMoney(label) ? money(value) : String(value ?? 0)}</strong></article>)}</div><section className="vendor-data-card"><h2>{tab === "Products" || tab === "Inventory" ? "My products" : tab === "Orders" ? "Vendor orders" : tab === "Returns" ? "Returns and refunds" : tab === "Payouts" ? "Payout history" : "Recent activity"}</h2>{tab === "Payouts" && <><div className="vendor-payout-summary"><article><small>Available for payout</small><strong>{money(availablePayout)}</strong></article><article><small>Total payouts</small><strong>{money(totalPayouts)}</strong></article><article><small>Paid to date</small><strong>{money(paidPayouts)}</strong></article></div><p className="muted">Delivered orders become available here. Fanzzy admin reviews and creates the payout.</p>{payoutEligibleOrders.map((order) => <div className="vendor-data-row" key={`eligible-${String(order.id)}`}><span><strong>{String(order.sub_order_number)}</strong><small>Delivered · Awaiting payout</small></span><b>{money(order.vendor_net_amount)}</b></div>)}</>}{(tab === "Products" || tab === "Inventory") && data.products.map((product) => <div className="vendor-data-row" key={String(product.sku)}><span><strong>{String(product.name)}</strong><small>{String(product.sku)} · {String(product.vendor_status || "Draft")}</small></span><span className="vendor-row-actions"><b>{String(product.stock)} in stock</b><button className="vendor-edit-button" type="button" onClick={() => startEditingProduct(product)}>Edit</button><button className="vendor-delete-button" type="button" onClick={() => void deleteProduct(String(product.sku), String(product.name))}>Delete</button></span></div>)}{(tab === "Orders" || tab === "Returns") && displayedOrders.map((order) => <div className="vendor-data-row vendor-order-row" key={String(order.id)}><span><strong>{String(order.sub_order_number)}</strong><small>{String(order.status)} · {String(order.payment_status)}</small></span><span className="vendor-order-row-actions"><b>{money(order.vendor_net_amount)}</b><button className="vendor-order-view" type="button" onClick={() => void viewOrder(String(order.id))}><Eye size={15} aria-hidden="true" /> View</button></span></div>)}{tab === "Payouts" && data.payouts.map((payout) => <div className="vendor-data-row" key={String(payout.id)}><span><strong>{String(payout.payout_number)}</strong><small>{String(payout.status)}{payout.payment_method ? ` · ${String(payout.payment_method)}` : ""}</small></span><b>{money(payout.amount)}</b></div>)}{tab === "Notifications" && data.notifications.map((notification) => <div className="vendor-data-row" key={notification.id}><span><strong>{notification.title}</strong><small>{notification.body}</small></span></div>)}{(tab === "Returns" ? !displayedOrders.length : tab === "Payouts" ? !payoutEligibleOrders.length && !data.payouts.length : !data.products.length && !data.orders.length && !data.payouts.length) && <p className="muted">{tab === "Returns" ? "No return requests or refunds yet." : tab === "Payouts" ? "No payout records yet." : "No records yet."}</p>}</section></>}
    {(orderDetailsLoading || orderDetailsError || selectedOrderDetails) && <div className="vendor-order-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrderDetails(); }}><section className="vendor-order-modal" role="dialog" aria-modal="true" aria-label="Vendor order details"><button className="vendor-order-modal-close" type="button" onClick={closeOrderDetails} aria-label="Close order details"><X size={20} /></button>{orderDetailsLoading && !selectedOrderDetails && <div className="vendor-order-modal-state">Loading order details…</div>}{orderDetailsError && <div className="vendor-order-modal-state"><p className="vendor-error" role="alert">{orderDetailsError}</p><button className="button" type="button" onClick={closeOrderDetails}>Close</button></div>}{selectedOrderDetails && <><header className="vendor-order-modal-header"><p className="eyebrow">ORDER DETAILS</p><h2>{String(selectedOrderDetails.order.sub_order_number || selectedOrderDetails.order.main_order_id || "Order")}</h2><p>{String(selectedOrderDetails.order.status || "New")} · {String(selectedOrderDetails.order.payment_status || "pending")} · {String(selectedOrderDetails.order.payment_method || "")}</p>{orderDetailsLoading && <p className="muted" role="status">Loading product and tracking details…</p>}</header><section className="vendor-order-products"><p className="eyebrow">PRODUCTS</p>{selectedOrderDetails.items.map((item, index) => { const snapshot = item.product_snapshot && typeof item.product_snapshot === "object" ? item.product_snapshot : {}; const image = String(snapshot.variantImage || snapshot.image || ""); const variant = String(snapshot.variantName || snapshot.size || ""); return <article key={String(item.id || `${item.product_sku}-${index}`)}>{image ? <img src={image} alt={String(item.product_name || "Ordered product")} /> : <span className="vendor-order-product-placeholder" aria-hidden="true" /> }<div><strong>{String(item.product_name || "Product")}</strong><small>SKU {String(item.product_sku || "Not available")}</small>{variant && <small>Selected option: {variant}</small>}<small>Quantity: {String(item.quantity || 0)} · Unit price: {money(item.unit_price)}</small>{Number(item.allocated_discount) > 0 && <small>Discount: {money(item.allocated_discount)}</small>}</div><b>{money(item.vendor_net_amount)}</b></article>; })}{!selectedOrderDetails.items.length && <p className="muted">{orderDetailsLoading ? "Loading product details…" : "No product lines were saved for this order."}</p>}</section><section className="vendor-order-amounts"><p className="eyebrow">AMOUNT DETAILS</p><dl><div><dt>Product total</dt><dd>{money(selectedOrderDetails.order.gross_product_amount)}</dd></div><div><dt>Commission rate</dt><dd>{Number(selectedOrderDetails.order.commission_rate) || 0}%</dd></div><div><dt>Platform commission</dt><dd>{money(selectedOrderDetails.order.commission_amount)}</dd></div><div className="vendor-order-earnings"><dt>Vendor net amount <span>Your earnings</span></dt><dd>{money(selectedOrderDetails.order.vendor_net_amount)}</dd></div></dl></section><section className="vendor-order-customer"><p className="eyebrow">CUSTOMER</p><dl><div><dt>Name</dt><dd>{String(selectedCustomer.name || "Not provided")}</dd></div><div><dt>Phone</dt><dd>{String(selectedCustomer.phone || "Not provided")}</dd></div><div><dt>Address</dt><dd>{String(selectedCustomer.address || "Not provided")}</dd></div></dl></section>{selectedTracking?.fulfillmentMethod !== "pickup" && <section className="vendor-order-tracking"><p className="eyebrow">ORDER TRACKING</p>{selectedTracking?.waybill ? <><div className="vendor-tracking-summary"><div><small>DELHIVERY AWB</small><strong>{selectedTracking.waybill}</strong></div><div><small>LIVE STATUS</small><strong>{selectedTracking.liveStatus || "Ready to ship"}</strong>{selectedTracking.liveLocation && <span>{selectedTracking.liveLocation}</span>}</div></div>{selectedTracking.trackingUrl && <a className="vendor-tracking-link" href={vendorTrackingUrl(selectedTracking.waybill, selectedTracking.trackingUrl)} target="_blank" rel="noreferrer">Open Delhivery tracking <ExternalLink size={14} aria-hidden="true" /></a>}<div className="vendor-live-timeline"><p className="eyebrow">LIVE DELIVERY TIMELINE</p>{(() => { const currentStage = trackingStageIndex(selectedTracking.liveStatus || "Ready to ship"); const scans = selectedTracking.scans || []; return <><ol className="tracking-stage-list" aria-label="Delhivery delivery progress">{trackingStages.map((stage, index) => { const current = index === currentStage; const completed = index < currentStage; const scan = scans.find((candidate) => stage.match.test(`${candidate.status} ${candidate.instructions || ""}`)); const date = scan?.date || (current ? selectedTracking.liveStatusDate : index === 0 ? selectedTracking.shipmentCreatedAt : index === 1 ? selectedTracking.pickupRequestDate : ""); const detail = current ? index === 2 && selectedTracking.liveLocation ? `Moving through ${selectedTracking.liveLocation}.` : index === 3 ? "The parcel is out for delivery." : index === 4 ? "The order has been delivered." : index === 1 ? "Pickup has been scheduled with Delhivery." : "The parcel is being prepared." : completed ? "Completed" : "Waiting for update"; return <li className={`${completed ? "completed " : ""}${current ? "current" : "upcoming"}`} aria-current={current ? "step" : undefined} key={stage.key}><span className="tracking-stage-dot" /><div><strong>{stage.label}</strong><small>{detail}</small>{date && <time>{trackingDate(date)}</time>}</div></li>; })}</ol>{scans.length > 0 && <div className="tracking-scan-summary"><strong>Latest courier scan</strong><span>{scans[0].status}{scans[0].location ? ` · ${scans[0].location}` : ""}</span>{scans[0].date && <time>{trackingDate(scans[0].date)}</time>}</div>}</>; })()}</div></> : <div className="vendor-tracking-notice"><strong>{orderDetailsLoading ? "Loading tracking details…" : "Tracking is not available yet"}</strong>{!orderDetailsLoading && <span>{selectedTracking?.shipmentStatus === "failed" ? selectedTracking.shipmentError || "Shipment creation needs attention." : "The Delhivery timeline will appear after the shipment and AWB are created."}</span>}</div>}</section>}</>}</section></div>}
  </section></main>;
}
