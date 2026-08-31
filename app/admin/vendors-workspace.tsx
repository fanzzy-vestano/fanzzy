"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { uploadStoreImage } from "../../lib/supabase/catalog";

type Vendor = {
  id: string;
  business_name: string;
  owner_name: string;
  login_email: string;
  status: string;
  store_visibility: string;
  featured: boolean;
  slug: string;
  commission_rate: number;
  commission_mode?: "percentage" | "fixed";
  commission_fixed?: number;
  automatic_approval: boolean;
};

type VendorProduct = {
  sku: string;
  name: string;
  category?: string;
  stock?: number;
  price?: number;
  status?: string;
  vendor_status?: string;
  vendor_rejection_reason?: string | null;
};

type VendorOrder = {
  id: string;
  sub_order_number: string;
  main_order_id: string;
  order_date: string;
  status: string;
  payment_status: string;
  vendor_net_amount: number;
  gross_product_amount?: number;
  commission_amount?: number;
  payout_status?: string;
};

type CommissionRule = {
  id: string;
  scope_type: "global" | "vendor" | "category" | "product";
  scope_id?: string | null;
  mode: "percentage" | "fixed";
  rate: number;
  fixed_amount: number;
  active: boolean;
};

type VendorPayout = {
  id: string;
  vendor_id: string;
  payout_number: string;
  status: string;
  amount: number;
  payment_method?: string;
  transaction_reference?: string | null;
  payout_date?: string | null;
};

type VendorReport = {
  rows: Array<{ vendorId: string; vendorName: string; status: string; orderCount: number; deliveredOrders: number; grossSales: number; commission: number; vendorEarnings: number; paidOut: number; productCount: number; publishedProducts: number; lowStockProducts: number }>;
  totals: { vendors: number; orders: number; grossSales: number; commission: number; vendorEarnings: number; paidOut: number; products: number; publishedProducts: number };
};

const empty = {
  businessName: "", ownerName: "", loginEmail: "", initialPassword: "", confirmPassword: "", phone: "", whatsappNumber: "", logoUrl: "", coverUrl: "", description: "", address: "", city: "", state: "", pinCode: "", gstNumber: "", panNumber: "", accountHolderName: "", accountNumber: "", bankName: "", branchName: "", ifscCode: "", upiId: "", commissionPercentage: "0", status: "Active", storeVisibility: "Visible", featured: false, automaticApproval: false,
};

const vendorTabs = ["All Vendors", "Create Vendor", "Vendor Products", "Vendor Orders", "Commissions", "Payouts", "Vendor Reports", "Vendor Settings"];
const money = (value: unknown) => `₹${(Number(value) || 0).toLocaleString("en-IN")}`;

export default function AdminVendorsWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [tab, setTab] = useState("All Vendors");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [form, setForm] = useState(empty);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [vendorProducts, setVendorProducts] = useState<VendorProduct[]>([]);
  const [vendorOrders, setVendorOrders] = useState<VendorOrder[]>([]);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [commissionForm, setCommissionForm] = useState({ id: "", scopeType: "global", scopeId: "", mode: "percentage", rate: "0", fixedAmount: "0", active: true });
  const [payouts, setPayouts] = useState<VendorPayout[]>([]);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutVendorId, setPayoutVendorId] = useState("");
  const [payoutOrderIds, setPayoutOrderIds] = useState<string[]>([]);
  const [payoutForm, setPayoutForm] = useState({ paymentMethod: "Bank transfer", transactionReference: "" });
  const [report, setReport] = useState<VendorReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [settingsVendorId, setSettingsVendorId] = useState("");
  const [settingsDraft, setSettingsDraft] = useState({ status: "Active", storeVisibility: "Hidden", commissionMode: "percentage", commissionPercentage: "0", commissionFixed: "0", automaticApproval: false, featured: false });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [coverPreview, setCoverPreview] = useState("");

  const load = () => fetch("/api/admin/vendors", { cache: "no-store" }).then(async (response) => {
    const body = await response.json() as { vendors?: Vendor[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Could not load vendors");
    setVendors(body.vendors || []);
  }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load vendors"));

  const loadCommissions = async () => {
    setCommissionLoading(true);
    try {
      const response = await fetch("/api/admin/vendor-commissions", { cache: "no-store" });
      const body = await response.json() as { rules?: CommissionRule[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load commission rules");
      setCommissionRules(body.rules || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load commission rules");
    } finally {
      setCommissionLoading(false);
    }
  };

  const loadPayouts = async () => {
    setPayoutLoading(true);
    try {
      const response = await fetch("/api/admin/vendor-payouts", { cache: "no-store" });
      const body = await response.json() as { payouts?: VendorPayout[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load payouts");
      setPayouts(body.payouts || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load payouts");
    } finally {
      setPayoutLoading(false);
    }
  };

  const loadReport = async () => {
    setReportLoading(true);
    try {
      const response = await fetch("/api/admin/vendor-reports", { cache: "no-store" });
      const body = await response.json() as VendorReport & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load vendor report");
      setReport(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load vendor report");
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const loadDetails = async (vendor: Vendor, nextTab: string) => {
    if (nextTab !== "Vendor Products" && nextTab !== "Vendor Orders") return;
    setSelected(vendor);
    setDetailError("");
    setDetailLoading(true);
    try {
      const endpoint = nextTab === "Vendor Products" ? "products" : "orders";
      const response = await fetch(`/api/admin/vendors/${encodeURIComponent(vendor.id)}/${endpoint}`, { cache: "no-store" });
      const body = await response.json() as { products?: VendorProduct[]; orders?: VendorOrder[]; error?: string };
      if (!response.ok) throw new Error(body.error || `Could not load vendor ${endpoint}`);
      if (nextTab === "Vendor Products") setVendorProducts(body.products || []);
      else setVendorOrders(body.orders || []);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Could not load vendor data");
    } finally {
      setDetailLoading(false);
    }
  };

  const chooseTab = (nextTab: string) => {
    setTab(nextTab);
    setManageOpen(false);
    setError("");
    if (nextTab === "Vendor Products" || nextTab === "Vendor Orders") {
      const vendor = selected || vendors[0];
      if (vendor) void loadDetails(vendor, nextTab);
    }
    if (nextTab === "Commissions") void loadCommissions();
    if (nextTab === "Payouts") {
      void loadPayouts();
      const vendor = selected || vendors[0];
      if (vendor) {
        setPayoutVendorId(vendor.id);
        void loadDetails(vendor, "Vendor Orders");
      }
    }
    if (nextTab === "Vendor Reports") void loadReport();
    if (nextTab === "Vendor Settings") {
      const vendor = selected || vendors[0];
      if (vendor) {
        setSelected(vendor);
        setSettingsVendorId(vendor.id);
        setSettingsDraft({ status: vendor.status, storeVisibility: vendor.store_visibility, commissionMode: vendor.commission_mode || "percentage", commissionPercentage: String(vendor.commission_rate || 0), commissionFixed: String(vendor.commission_fixed || 0), automaticApproval: Boolean(vendor.automatic_approval), featured: Boolean(vendor.featured) });
      }
    }
  };

  const selectVendor = (vendor: Vendor, nextTab: string) => {
    setTab(nextTab);
    setManageOpen(false);
    void loadDetails(vendor, nextTab);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isCreating) return;
    setError("");
    if (form.initialPassword !== form.confirmPassword) return setError("Passwords do not match.");
    setIsCreating(true);
    try {
      let logoUrl = form.logoUrl;
      let coverUrl = form.coverUrl;
      if (logoFile) {
        const upload = await uploadStoreImage(logoFile, "vendors");
        if (upload.error || !upload.url) return setError("Could not upload the vendor logo. Please try again.");
        logoUrl = upload.url;
      }
      if (coverFile) {
        const upload = await uploadStoreImage(coverFile, "vendors");
        if (upload.error || !upload.url) return setError("Could not upload the vendor cover image. Please try again.");
        coverUrl = upload.url;
      }
      const response = await fetch("/api/admin/vendors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, logoUrl, coverUrl, commissionPercentage: Number(form.commissionPercentage) }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return setError(body.error || `Could not create vendor (${response.status}).`);
      setForm(empty);
      setLogoFile(null);
      setCoverFile(null);
      setLogoPreview("");
      setCoverPreview("");
      setTab("All Vendors");
      onNotify("Vendor created");
      void load();
    } catch {
      setError("Could not reach the vendor service. Make sure the local server is running and try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const chooseImage = async (kind: "logo" | "cover", event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    const preview = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not preview image"));
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (kind === "logo") {
      setLogoFile(file);
      setLogoPreview(preview);
    } else {
      setCoverFile(file);
      setCoverPreview(preview);
    }
  };

  const update = async (id: string, body: Record<string, unknown>, message: string) => {
    const response = await fetch(`/api/admin/vendors/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setError(result.error || "Could not update vendor");
    onNotify(message);
    void load();
  };

  const remove = async (vendor: Vendor) => {
    if (!window.confirm(`Delete ${vendor.business_name}? Products will remain in the catalog and order history will be preserved without this vendor link.`)) return;
    setError("");
    try {
      const response = await fetch(`/api/admin/vendors/${encodeURIComponent(vendor.id)}`, { method: "DELETE" });
      const body = await response.json() as { deleted?: { businessName?: string }; error?: string };
      if (!response.ok) return setError(body.error || "Could not delete vendor");
      if (selected?.id === vendor.id) setSelected(null);
      setManageOpen(false);
      onNotify(`${body.deleted?.businessName || vendor.business_name} deleted`);
      void load();
    } catch {
      setError("Could not reach the vendor service. Make sure the local server is running and try again.");
    }
  };

  const reviewProduct = async (product: VendorProduct, decision: "Approved" | "Rejected" | "Inactive") => {
    if (!selected) return;
    const reason = decision === "Rejected" ? (window.prompt("Reason for rejection") || "").trim() : undefined;
    if (decision === "Rejected" && !reason) return;
    const response = await fetch(`/api/admin/vendors/${encodeURIComponent(selected.id)}/products/${encodeURIComponent(product.sku)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setDetailError(body.error || "Could not review product");
    onNotify(`Product ${decision.toLowerCase()}`);
    void loadDetails(selected, "Vendor Products");
  };

  const saveCommission = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/admin/vendor-commissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(commissionForm) });
      const body = await response.json() as { rule?: CommissionRule; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not save commission rule");
      setCommissionForm({ id: "", scopeType: "global", scopeId: "", mode: "percentage", rate: "0", fixedAmount: "0", active: true });
      onNotify("Commission rule saved");
      void loadCommissions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save commission rule");
    }
  };

  const deleteCommission = async (id: string) => {
    if (!window.confirm("Delete this commission rule?")) return;
    const response = await fetch(`/api/admin/vendor-commissions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setError(body.error || "Could not delete commission rule");
    onNotify("Commission rule deleted");
    void loadCommissions();
  };

  const chooseSettingsVendor = (vendorId: string) => {
    const vendor = vendors.find((item) => item.id === vendorId);
    if (!vendor) return;
    setSelected(vendor);
    setSettingsVendorId(vendor.id);
    setSettingsDraft({ status: vendor.status, storeVisibility: vendor.store_visibility, commissionMode: vendor.commission_mode || "percentage", commissionPercentage: String(vendor.commission_rate || 0), commissionFixed: String(vendor.commission_fixed || 0), automaticApproval: Boolean(vendor.automatic_approval), featured: Boolean(vendor.featured) });
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settingsVendorId) return setError("Choose a vendor first.");
    const response = await fetch(`/api/admin/vendors/${encodeURIComponent(settingsVendorId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(settingsDraft) });
    const body = await response.json() as { vendor?: Vendor; error?: string };
    if (!response.ok) return setError(body.error || "Could not save vendor settings");
    setSelected(body.vendor || selected);
    onNotify("Vendor settings saved");
    void load();
  };

  const choosePayoutVendor = (vendorId: string) => {
    const vendor = vendors.find((item) => item.id === vendorId);
    setPayoutVendorId(vendorId);
    setPayoutOrderIds([]);
    if (vendor) {
      setSelected(vendor);
      void loadDetails(vendor, "Vendor Orders");
    }
  };

  const createPayout = async () => {
    if (!payoutVendorId) return setError("Choose a vendor for the payout.");
    if (!payoutOrderIds.length) return setError("Select at least one delivered order.");
    const response = await fetch("/api/admin/vendor-payouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendorId: payoutVendorId, orderIds: payoutOrderIds, paymentMethod: payoutForm.paymentMethod, transactionReference: payoutForm.transactionReference, status: "Approved" }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) return setError(body.error || "Could not create payout");
    setPayoutOrderIds([]);
    setPayoutForm({ paymentMethod: "Bank transfer", transactionReference: "" });
    onNotify("Vendor payout created");
    void loadPayouts();
    if (selected) void loadDetails(selected, "Vendor Orders");
  };

  const field = (key: keyof typeof form, label: string, type = "text", className = "") => {
    const passwordField = type === "password";
    const visible = key === "initialPassword" ? showInitialPassword : showConfirmPassword;
    const setVisible = key === "initialPassword" ? setShowInitialPassword : setShowConfirmPassword;
    const input = <input type={passwordField && visible ? "text" : type} value={String(form[key])} onChange={(event) => setForm({ ...form, [key]: type === "checkbox" ? event.target.checked : event.target.value })} />;
    return <label className={className}>{label}{passwordField ? <span className="vendor-password-control">{input}<button className="vendor-password-toggle" type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} title={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}</button></span> : input}</label>;
  };
  const imageField = (kind: "logo" | "cover", label: string, className = "") => { const preview = kind === "logo" ? logoPreview : coverPreview; return <label className={`vendor-image-upload ${className}`}><span>{label}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseImage(kind, event)} /><small>PNG, JPG, or WebP</small>{preview && <img src={preview} alt={`${label} preview`} />}</label>; };
  const vendorPicker = (label: string) => <label className="vendor-admin-selector">{label}<select value={selected?.id || ""} onChange={(event) => { const vendor = vendors.find((item) => item.id === event.target.value); if (vendor) void loadDetails(vendor, tab); }}><option value="">Choose a vendor</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.business_name}</option>)}</select></label>;

  return <section className="panel module-workspace vendors-workspace">
    <div className="module-workspace-head"><div><p className="eyebrow">MARKETPLACE</p><h2>Vendors</h2><p>Manage vendor accounts, approvals, orders, commissions, payouts, and reports without changing the existing store workspace.</p></div><div className="module-actions"><button className="module-primary" onClick={() => chooseTab("Create Vendor")}>+ Create vendor</button></div></div>
    <div className="vendor-admin-tabs">{vendorTabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => chooseTab(item)}>{item}</button>)}</div>
    {error && <p className="vendor-error" role="alert">{error}</p>}

    {tab === "Create Vendor" && <form className="vendor-form-card admin-vendor-form" onSubmit={create}><div className="vendor-form-heading"><div><p className="eyebrow">NEW ACCOUNT</p><h3>Create vendor</h3></div><p>Set up the vendor profile, login access, payout details, and storefront controls.</p></div><div className="vendor-form-section"><div className="vendor-form-section-heading"><h4>Account access</h4><p>These details are used by the vendor to sign in.</p></div><div className="vendor-form-grid vendor-form-grid-three">{field("businessName", "Vendor / business name")} {field("ownerName", "Owner name")} {field("loginEmail", "Login email", "email")} {field("initialPassword", "Initial password", "password")} {field("confirmPassword", "Confirm password", "password")}</div></div><div className="vendor-form-section"><div className="vendor-form-section-heading"><h4>Contact & branding</h4><p>Add the public contact information and upload storefront imagery.</p></div><div className="vendor-form-grid vendor-form-grid-three">{field("phone", "Phone number")} {field("whatsappNumber", "WhatsApp number")} {imageField("logo", "Logo image")} {imageField("cover", "Cover image", "vendor-form-wide")}</div></div><div className="vendor-form-section"><div className="vendor-form-section-heading"><h4>Business details</h4><p>Help customers and operations teams identify the business.</p></div><div className="vendor-form-grid vendor-form-grid-three"><label className="vendor-form-wide">Business address<textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Street address, building, or landmark" /></label>{field("city", "City")} {field("state", "State")} {field("pinCode", "PIN code")}<label className="vendor-form-wide">Business description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="A short description of this vendor" /></label></div></div><div className="vendor-form-section"><div className="vendor-form-section-heading"><h4>Tax & payouts</h4><p>Keep compliance and settlement information together.</p></div><div className="vendor-form-grid vendor-form-grid-three">{field("gstNumber", "GST number")} {field("panNumber", "PAN number")} {field("accountHolderName", "Bank account holder")} {field("accountNumber", "Bank account number")} {field("bankName", "Bank name")} {field("branchName", "Branch name")} {field("ifscCode", "IFSC code")} {field("upiId", "UPI ID")}</div></div><div className="vendor-form-section"><div className="vendor-form-section-heading"><h4>Store controls</h4><p>Choose how this vendor appears and how products are handled.</p></div><div className="vendor-form-grid vendor-form-grid-three"><label className="vendor-form-explainer"><span>Fanzzy commission percentage</span><input type="number" min="0" step="0.01" value={form.commissionPercentage} onChange={(event) => setForm({ ...form, commissionPercentage: event.target.value })} /><small>Fanzzy keeps this percentage from each vendor sale. The vendor receives the remaining amount after discounts. Example: ₹1,000 at 10% = ₹100 commission and ₹900 vendor earnings.</small></label><label>Account status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>Active</option><option>Suspended</option><option>Inactive</option></select></label><label>Store visibility<select value={form.storeVisibility} onChange={(event) => setForm({ ...form, storeVisibility: event.target.value })}><option>Visible</option><option>Hidden</option></select></label></div><div className="vendor-form-options"><label><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} /><span><strong>Featured vendor</strong><small>Shows this vendor first in marketplace sections. It does not approve products.</small></span></label><label><input type="checkbox" checked={form.automaticApproval} onChange={(event) => setForm({ ...form, automaticApproval: event.target.checked })} /><span><strong>Automatic product approval</strong><small>New products skip admin review and can publish immediately when their details are complete. Enabling it also approves this vendor’s existing pending products.</small></span></label></div></div><div className="vendor-form-actions"><p>Fields can be updated later from the vendor account manager.</p><span className="vendor-form-action-stack">{error && <small className="vendor-form-error" role="alert">{error}</small>}<button className="module-primary" type="submit" disabled={isCreating}>{isCreating ? "Creating vendor…" : "Create vendor securely"}</button></span></div></form>}

    {tab === "All Vendors" && <div className="vendor-admin-list">{vendors.map((vendor) => <article className="vendor-admin-row" key={vendor.id}><div><strong>{vendor.business_name}</strong><small>{vendor.owner_name} · {vendor.login_email} · /vendors/{vendor.slug}</small></div><span>{vendor.status} · {vendor.store_visibility}</span><div className="module-actions"><button className="module-secondary" onClick={() => { setSelected(vendor); setManageOpen(true); }}>Manage</button><button className="module-secondary" onClick={() => selectVendor(vendor, "Vendor Products")}>Products</button><button className="module-secondary" onClick={() => selectVendor(vendor, "Vendor Orders")}>Orders</button><button className="module-secondary" onClick={() => void update(vendor.id, { action: "force-logout" }, "Vendor sessions invalidated")}>Force logout</button><button className="module-secondary delete-action" onClick={() => void remove(vendor)}>Delete</button></div></article>)}{!vendors.length && <p className="muted">No vendors created yet.</p>}</div>}

    {(tab === "Vendor Products" || tab === "Vendor Orders") && <div className="vendor-admin-detail">{vendorPicker(tab === "Vendor Products" ? "View vendor products" : "View vendor orders")}{selected && <div className="vendor-admin-detail-head"><div><p className="eyebrow">{tab === "Vendor Products" ? "PRODUCT CATALOG" : "ORDER QUEUE"}</p><h3>{selected.business_name}</h3></div><span>{selected.login_email}</span></div>}{detailError && <p className="vendor-error" role="alert">{detailError}</p>}{detailLoading && <p className="muted">Loading vendor data…</p>}{!detailLoading && tab === "Vendor Products" && selected && <div className="vendor-admin-data-list">{vendorProducts.map((product) => <article className="vendor-admin-data-row" key={product.sku}><div><strong>{product.name}</strong><small>{product.sku} · {product.category || "Uncategorised"} · {product.stock ?? 0} in stock</small></div><span>{product.vendor_status || product.status || "Draft"}</span><div className="module-actions"><button className="module-secondary" onClick={() => void reviewProduct(product, "Approved")}>Approve</button><button className="module-secondary" onClick={() => void reviewProduct(product, "Rejected")}>Reject</button><button className="module-secondary delete-action" onClick={() => void reviewProduct(product, "Inactive")}>Inactive</button></div></article>)}{!vendorProducts.length && <p className="muted">No products for this vendor yet.</p>}</div>}{!detailLoading && tab === "Vendor Orders" && selected && <div className="vendor-admin-data-list">{vendorOrders.map((order) => <article className="vendor-admin-data-row" key={order.id}><div><strong>{order.sub_order_number}</strong><small>Main order {order.main_order_id} · {order.order_date ? new Date(order.order_date).toLocaleString("en-IN") : "—"}</small></div><span>{order.status} · {order.payment_status}</span><b>{money(order.vendor_net_amount)}</b></article>)}{!vendorOrders.length && <p className="muted">No vendor orders yet.</p>}</div>}{!vendors.length && <p className="muted">Create a vendor first to view products and orders.</p>}</div>}

    {tab === "Commissions" && <div className="vendor-admin-tools"><div className="vendor-admin-detail-head"><div><p className="eyebrow">COMMISSION CONTROL</p><h3>Rules and order commissions</h3></div><button className="module-secondary" onClick={() => void loadCommissions()}>Refresh</button></div><form className="vendor-admin-rule-form" onSubmit={saveCommission}><label>Scope<select value={commissionForm.scopeType} onChange={(event) => setCommissionForm({ ...commissionForm, scopeType: event.target.value, scopeId: "" })}><option value="global">Global</option><option value="vendor">Vendor</option><option value="category">Category</option><option value="product">Product SKU</option></select></label>{commissionForm.scopeType === "vendor" ? <label>Vendor<select value={commissionForm.scopeId} onChange={(event) => setCommissionForm({ ...commissionForm, scopeId: event.target.value })}><option value="">Choose a vendor</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.business_name}</option>)}</select></label> : commissionForm.scopeType === "global" ? <span className="vendor-admin-rule-note">Applies when no more specific rule matches.</span> : <label>{commissionForm.scopeType === "category" ? "Category name" : "Product SKU"}<input value={commissionForm.scopeId} onChange={(event) => setCommissionForm({ ...commissionForm, scopeId: event.target.value })} placeholder={commissionForm.scopeType === "category" ? "Earrings" : "SKU-123"} /></label>}<label>Mode<select value={commissionForm.mode} onChange={(event) => setCommissionForm({ ...commissionForm, mode: event.target.value })}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>{commissionForm.mode === "percentage" ? <label>Rate (%)<input type="number" min="0" step="0.01" value={commissionForm.rate} onChange={(event) => setCommissionForm({ ...commissionForm, rate: event.target.value })} /></label> : <label>Fixed amount<input type="number" min="0" step="0.01" value={commissionForm.fixedAmount} onChange={(event) => setCommissionForm({ ...commissionForm, fixedAmount: event.target.value })} /></label>}<label className="vendor-admin-check"><input type="checkbox" checked={commissionForm.active} onChange={(event) => setCommissionForm({ ...commissionForm, active: event.target.checked })} /> Active</label><button className="module-primary" type="submit">{commissionForm.id ? "Update rule" : "Save rule"}</button>{commissionForm.id && <button className="module-secondary" type="button" onClick={() => setCommissionForm({ id: "", scopeType: "global", scopeId: "", mode: "percentage", rate: "0", fixedAmount: "0", active: true })}>Cancel</button>}</form>{commissionLoading ? <p className="muted">Loading commission rules…</p> : <div className="vendor-admin-data-list">{commissionRules.map((rule) => <article className="vendor-admin-data-row" key={rule.id}><div><strong>{rule.scope_type === "global" ? "Global rule" : rule.scope_type === "vendor" ? vendors.find((vendor) => vendor.id === rule.scope_id)?.business_name || "Vendor rule" : `${rule.scope_type}: ${rule.scope_id || "—"}`}</strong><small>{rule.mode === "fixed" ? money(rule.fixed_amount) : `${Number(rule.rate || 0)}%`} · {rule.active ? "Active" : "Inactive"}</small></div><div className="module-actions"><button className="module-secondary" onClick={() => setCommissionForm({ id: rule.id, scopeType: rule.scope_type, scopeId: rule.scope_id || "", mode: rule.mode, rate: String(rule.rate || 0), fixedAmount: String(rule.fixed_amount || 0), active: Boolean(rule.active) })}>Edit</button><button className="module-secondary delete-action" onClick={() => void deleteCommission(rule.id)}>Delete</button></div></article>)}{!commissionRules.length && <p className="muted">No commission rules configured yet.</p>}</div>}</div>}

    {tab === "Payouts" && <div className="vendor-admin-tools"><div className="vendor-admin-detail-head"><div><p className="eyebrow">SETTLEMENTS</p><h3>Vendor payouts</h3></div><button className="module-secondary" onClick={() => void loadPayouts()}>Refresh</button></div><div className="vendor-admin-payout-layout"><div><label className="vendor-admin-selector">Vendor<select value={payoutVendorId} onChange={(event) => choosePayoutVendor(event.target.value)}><option value="">Choose a vendor</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.business_name}</option>)}</select></label>{selected && payoutVendorId === selected.id && <div className="vendor-admin-payout-orders"><h4>Delivered orders ready for payout</h4>{vendorOrders.filter((order) => order.status === "Delivered" && !["Paid", "Approved", "Processing", "Pending"].includes(String(order.payout_status || ""))).map((order) => <label className="vendor-admin-payout-order" key={order.id}><input type="checkbox" checked={payoutOrderIds.includes(order.id)} onChange={(event) => setPayoutOrderIds(event.target.checked ? [...payoutOrderIds, order.id] : payoutOrderIds.filter((id) => id !== order.id))} /><span><strong>{order.sub_order_number}</strong><small>{money(order.vendor_net_amount)} · {order.payout_status || "Not paid"}</small></span></label>)}{!vendorOrders.some((order) => order.status === "Delivered" && !["Paid", "Approved", "Processing", "Pending"].includes(String(order.payout_status || ""))) && <p className="muted">No delivered orders are ready for payout.</p>}</div>}<div className="vendor-admin-payout-form"><label>Payment method<select value={payoutForm.paymentMethod} onChange={(event) => setPayoutForm({ ...payoutForm, paymentMethod: event.target.value })}><option>Bank transfer</option><option>UPI</option><option>Cash</option></select></label><label>Transaction reference<input value={payoutForm.transactionReference} onChange={(event) => setPayoutForm({ ...payoutForm, transactionReference: event.target.value })} placeholder="UTR or payment reference" /></label><button className="module-primary" onClick={() => void createPayout()}>Create payout</button></div></div><div><h4>Recent payouts</h4>{payoutLoading ? <p className="muted">Loading payouts…</p> : <div className="vendor-admin-data-list">{payouts.map((payout) => <article className="vendor-admin-data-row" key={payout.id}><div><strong>{payout.payout_number}</strong><small>{vendors.find((vendor) => vendor.id === payout.vendor_id)?.business_name || "Vendor"} · {payout.payment_method || "—"}</small></div><span>{payout.status}</span><b>{money(payout.amount)}</b></article>)}{!payouts.length && <p className="muted">No payouts created yet.</p>}</div>}</div></div></div>}

    {tab === "Vendor Reports" && <div className="vendor-admin-tools"><div className="vendor-admin-detail-head"><div><p className="eyebrow">PERFORMANCE</p><h3>Vendor reports</h3></div><button className="module-secondary" onClick={() => void loadReport()}>Refresh</button></div>{reportLoading && <p className="muted">Loading vendor report…</p>}{report && <><div className="vendor-admin-report-stats"><article><small>Gross sales</small><strong>{money(report.totals.grossSales)}</strong></article><article><small>Commission</small><strong>{money(report.totals.commission)}</strong></article><article><small>Vendor earnings</small><strong>{money(report.totals.vendorEarnings)}</strong></article><article><small>Paid out</small><strong>{money(report.totals.paidOut)}</strong></article><article><small>Orders</small><strong>{report.totals.orders}</strong></article><article><small>Published products</small><strong>{report.totals.publishedProducts}</strong></article></div><div className="vendor-admin-report-table"><div className="vendor-admin-report-row vendor-admin-report-header"><span>Vendor</span><span>Orders</span><span>Sales</span><span>Commission</span><span>Net earnings</span><span>Products</span></div>{report.rows.map((row) => <div className="vendor-admin-report-row" key={row.vendorId}><strong>{row.vendorName}<small>{row.status}</small></strong><span>{row.orderCount} ({row.deliveredOrders} delivered)</span><span>{money(row.grossSales)}</span><span>{money(row.commission)}</span><span>{money(row.vendorEarnings)}</span><span>{row.publishedProducts}/{row.productCount} live · {row.lowStockProducts} low</span></div>)}</div></>}{!reportLoading && !report && <p className="muted">No report data available.</p>}</div>}

    {tab === "Vendor Settings" && <div className="vendor-admin-tools"><div className="vendor-admin-detail-head"><div><p className="eyebrow">CONTROL CENTER</p><h3>Vendor settings</h3></div></div><form className="vendor-admin-settings-form" onSubmit={saveSettings}><label className="vendor-admin-selector">Vendor<select value={settingsVendorId} onChange={(event) => chooseSettingsVendor(event.target.value)}><option value="">Choose a vendor</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.business_name}</option>)}</select></label>{settingsVendorId && <><div className="vendor-admin-settings-grid"><label>Account status<select value={settingsDraft.status} onChange={(event) => setSettingsDraft({ ...settingsDraft, status: event.target.value })}><option>Active</option><option>Suspended</option><option>Inactive</option></select></label><label>Store visibility<select value={settingsDraft.storeVisibility} onChange={(event) => setSettingsDraft({ ...settingsDraft, storeVisibility: event.target.value })}><option>Visible</option><option>Hidden</option></select></label><label>Commission mode<select value={settingsDraft.commissionMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, commissionMode: event.target.value })}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label><label>Commission percentage<input type="number" min="0" step="0.01" value={settingsDraft.commissionPercentage} onChange={(event) => setSettingsDraft({ ...settingsDraft, commissionPercentage: event.target.value })} /></label><label>Commission fixed amount<input type="number" min="0" step="0.01" value={settingsDraft.commissionFixed} onChange={(event) => setSettingsDraft({ ...settingsDraft, commissionFixed: event.target.value })} /></label></div><div className="vendor-admin-settings-checks"><label><input type="checkbox" checked={settingsDraft.featured} onChange={(event) => setSettingsDraft({ ...settingsDraft, featured: event.target.checked })} /> Featured vendor</label><label><input type="checkbox" checked={settingsDraft.automaticApproval} onChange={(event) => setSettingsDraft({ ...settingsDraft, automaticApproval: event.target.checked })} /> Automatic product approval</label></div><button className="module-primary" type="submit">Save vendor settings</button></>}</form>{!vendors.length && <p className="muted">Create a vendor first to configure settings.</p>}</div>}

    {manageOpen && selected && <div className="product-modal-backdrop" onClick={() => setManageOpen(false)}><div className="product-modal-card vendor-manage-modal" role="dialog" aria-modal="true" aria-labelledby="vendor-manage-title" onClick={(event) => event.stopPropagation()}><button className="product-modal-close" aria-label="Close vendor account" onClick={() => setManageOpen(false)}>×</button><p className="eyebrow">VENDOR ACCOUNT</p><h3 id="vendor-manage-title">{selected.business_name}</h3><div className="vendor-manage-fields"><label><span>Status</span><select value={selected.status} onChange={(event) => void update(selected.id, { status: event.target.value }, "Vendor status updated")}><option>Active</option><option>Suspended</option><option>Inactive</option></select></label><label><span>Store visibility</span><select value={selected.store_visibility} onChange={(event) => void update(selected.id, { storeVisibility: event.target.value }, "Vendor visibility updated")}><option>Visible</option><option>Hidden</option></select></label></div><div className="vendor-manage-password"><label><span>New password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Set a new password" /></label><button className="module-primary" onClick={() => { void update(selected.id, { action: "reset-password", password }, "Vendor password changed and sessions invalidated"); setPassword(""); }}>Change password</button></div></div></div>}
  </section>;
}
