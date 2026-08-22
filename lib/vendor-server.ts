import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual, createCipheriv } from "node:crypto";
import { promisify } from "node:util";
import { allocateProRata, calculateCommission, groupOrderItemsByVendor, resolveCommissionRule, slugifyVendorName, type CommissionRule, type VendorAccountStatus, type VendorOrderStatus, type VendorProductStatus } from "./vendor-marketplace";

const scrypt = promisify(nodeScrypt);
const VENDOR_COOKIE = "fanzzy_vendor_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

export type VendorRecord = {
  id: string;
  slug: string;
  business_name: string;
  owner_name: string;
  login_email: string;
  phone: string;
  whatsapp: string;
  logo_url?: string | null;
  cover_url?: string | null;
  description: string;
  address: string;
  city: string;
  state: string;
  pin_code: string;
  gst_number: string;
  pan_number: string;
  status: VendorAccountStatus;
  store_visibility: "Visible" | "Hidden";
  featured: boolean;
  commission_mode: "percentage" | "fixed";
  commission_rate: number;
  commission_fixed: number;
  automatic_approval: boolean;
  session_version: number;
  created_at: string;
  updated_at: string;
};

export type VendorSession = { vendorId: string; userId: string; email: string; vendor: VendorRecord };

type RestOptions = { method?: string; body?: unknown; privileged?: boolean; headers?: Record<string, string> };
const supabaseUrl = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey = (privileged: boolean) => privileged
  ? process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ""
  : process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

export class VendorDataError extends Error {
  status: number;
  constructor(message: string, status = 500) { super(message); this.name = "VendorDataError"; this.status = status; }
}

async function rest<T>(table: string, query = "", options: RestOptions = {}) {
  const url = supabaseUrl();
  const key = supabaseKey(options.privileged === true);
  if (!url || !key) throw new VendorDataError(options.privileged ? "Vendor administration is not configured on the server." : "Vendor service is not configured.", 503);
  const response = await fetch(`${url}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method: options.method || "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: "no-store",
  });
  const raw = await response.text();
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" && "message" in parsed ? String(parsed.message) : "Vendor data request failed";
    throw new VendorDataError(detail, response.status);
  }
  return parsed as T;
}

const hmacSecret = () => process.env.VENDOR_AUTH_SECRET?.trim() || process.env.ADMIN_AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const passwordDigest = async (password: string, salt = randomBytes(16).toString("base64url")) => {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
};
const passwordMatches = async (password: string, stored: string) => {
  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  return safeEqual(derived.toString("base64url"), expected);
};

const encryptionKey = () => createHash("sha256").update(process.env.VENDOR_DATA_ENCRYPTION_KEY?.trim() || hmacSecret() || "vendor-data-key-not-for-production").digest();
export function encryptConfidential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
const cookieValue = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VENDOR_COOKIE}=`))?.slice(VENDOR_COOKIE.length + 1) || "";
export const clearVendorSessionCookie = () => `${VENDOR_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
export const createVendorSessionCookie = (token: string) => `${VENDOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export async function getVendorSession(request: Request): Promise<VendorSession | null> {
  const token = cookieValue(request);
  if (!token || !hmacSecret()) return null;
  const rows = await rest<Array<{ vendor_id: string; vendor_user_id: string; session_version: number; expires_at: string }>>("vendor_sessions", `token_hash=eq.${encodeURIComponent(hashToken(token))}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=vendor_id,vendor_user_id,session_version,expires_at`, { privileged: true });
  const session = rows[0];
  if (!session) return null;
  const vendors = await rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(session.vendor_id)}&select=*`, { privileged: true });
  const vendor = vendors[0];
  const users = await rest<Array<{ id: string; email: string }>>("vendor_users", `id=eq.${encodeURIComponent(session.vendor_user_id)}&select=id,email`, { privileged: true });
  if (!vendor || !users[0] || vendor.status !== "Active" || vendor.session_version !== session.session_version) return null;
  return { vendorId: vendor.id, userId: users[0].id, email: users[0].email, vendor };
}

export async function audit(actorType: "admin" | "vendor" | "system", actorId: string | undefined, vendorId: string | undefined, action: string, entityType: string, entityId: string | undefined, metadata: Record<string, unknown> = {}) {
  try {
    await rest("vendor_audit_logs", "", { privileged: true, method: "POST", body: [{ actor_type: actorType, actor_id: actorId || null, vendor_id: vendorId || null, action, entity_type: entityType, entity_id: entityId || null, metadata }] });
  } catch { /* Audit failure must not break the business operation. */ }
}

export async function loginVendor(email: string, password: string, request: Request) {
  const normalizedEmail = email.trim().toLowerCase();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const attemptKey = `${ip}:${normalizedEmail}`;
  const attempt = loginAttempts.get(attemptKey);
  if (attempt && attempt.blockedUntil > Date.now()) throw new VendorDataError("Too many login attempts. Try again later.", 429);
  const users = await rest<Array<{ id: string; vendor_id: string; email: string; password_hash: string; failed_attempts: number; locked_until?: string | null }>>("vendor_users", `email=eq.${encodeURIComponent(normalizedEmail)}&select=*`, { privileged: true });
  const user = users[0];
  const vendors = user ? await rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(user.vendor_id)}&select=*`, { privileged: true }) : [];
  const vendor = vendors[0];
  const valid = Boolean(user && vendor && vendor.status === "Active" && (!user.locked_until || new Date(user.locked_until).getTime() <= Date.now()) && await passwordMatches(password, user.password_hash));
  if (!valid) {
    const nextCount = (attempt?.count || 0) + 1;
    loginAttempts.set(attemptKey, { count: nextCount, blockedUntil: nextCount >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
    if (user && nextCount >= 5) await rest("vendor_users", `id=eq.${encodeURIComponent(user.id)}`, { privileged: true, method: "PATCH", body: { failed_attempts: nextCount, locked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString() } });
    throw new VendorDataError("Incorrect vendor email or password.", 401);
  }
  loginAttempts.delete(attemptKey);
  const token = randomBytes(32).toString("base64url");
  await rest("vendor_sessions", "", { privileged: true, method: "POST", body: [{ vendor_user_id: user!.id, vendor_id: vendor!.id, token_hash: hashToken(token), session_version: vendor!.session_version, expires_at: new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString() }] });
  return { vendor, cookie: createVendorSessionCookie(token) };
}

export async function logoutVendor(request: Request) {
  const token = cookieValue(request);
  if (token) await rest("vendor_sessions", `token_hash=eq.${encodeURIComponent(hashToken(token))}`, { privileged: true, method: "DELETE" });
}

export type VendorInput = Partial<VendorRecord> & {
  businessName?: string;
  ownerName?: string;
  loginEmail?: string;
  initialPassword?: string;
  whatsappNumber?: string;
  logoUrl?: string;
  coverUrl?: string;
  commissionPercentage?: number;
  accountHolderName?: string;
  accountNumber?: string;
  bankName?: string;
  branchName?: string;
  ifscCode?: string;
  upiId?: string;
  pinCode?: string;
  gstNumber?: string;
  panNumber?: string;
  storeVisibility?: "Visible" | "Hidden";
  automaticApproval?: boolean;
};

export async function createVendor(input: VendorInput, actorId: string) {
  const businessName = String(input.businessName || input.business_name || "").trim();
  const ownerName = String(input.ownerName || input.owner_name || "").trim();
  const loginEmail = String(input.loginEmail || input.login_email || "").trim().toLowerCase();
  const password = String(input.initialPassword || "");
  if (!businessName || !ownerName || !/^\S+@\S+\.\S+$/.test(loginEmail)) throw new VendorDataError("Business name, owner name, and a valid login email are required.", 400);
  if (password.length < 8) throw new VendorDataError("Vendor passwords must be at least 8 characters.", 400);
  const slugBase = slugifyVendorName(businessName);
  const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;
  const vendorRows = await rest<VendorRecord[]>("vendors", "", { privileged: true, method: "POST", body: [{
    slug, business_name: businessName, owner_name: ownerName, login_email: loginEmail,
    phone: String(input.phone || "").trim(), whatsapp: String(input.whatsappNumber || input.whatsapp || "").trim(),
    logo_url: input.logoUrl || input.logo_url || null, cover_url: input.coverUrl || input.cover_url || null,
    description: String(input.description || "").trim(), address: String(input.address || "").trim(), city: String(input.city || "").trim(), state: String(input.state || "").trim(), pin_code: String(input.pin_code || input.pinCode || "").trim(), gst_number: String(input.gst_number || input.gstNumber || "").trim(), pan_number: String(input.pan_number || input.panNumber || "").trim(),
    status: input.status || "Active", store_visibility: input.store_visibility || input.storeVisibility || "Hidden", featured: Boolean(input.featured), automatic_approval: Boolean(input.automatic_approval || input.automaticApproval), commission_mode: input.commission_mode || "percentage", commission_rate: Number(input.commissionPercentage ?? input.commission_rate ?? 0) || 0, commission_fixed: Number(input.commission_fixed || 0) || 0,
  }], headers: { Prefer: "return=representation" } });
  const vendor = vendorRows[0];
  if (!vendor) throw new VendorDataError("Vendor could not be created.");
  try {
    await rest("vendor_users", "", { privileged: true, method: "POST", body: [{ vendor_id: vendor.id, email: loginEmail, password_hash: await passwordDigest(password) }] });
    await rest("vendor_bank_accounts", "", { privileged: true, method: "POST", body: [{ vendor_id: vendor.id, account_holder_name: String(input.accountHolderName || "").trim(), account_number: input.accountNumber ? encryptConfidential(String(input.accountNumber).trim()) : "", bank_name: String(input.bankName || "").trim(), branch_name: String(input.branchName || "").trim(), ifsc_code: String(input.ifscCode || "").trim().toUpperCase(), upi_id: String(input.upiId || "").trim() }] });
  } catch (error) {
    await rest("vendors", `id=eq.${encodeURIComponent(vendor.id)}`, { privileged: true, method: "DELETE" }).catch(() => undefined);
    throw error;
  }
  await audit("admin", actorId, vendor.id, "vendor.created", "vendor", vendor.id, { businessName, loginEmail });
  return vendor;
}

export async function resetVendorPassword(vendorId: string, password: string, actorId: string, forceLogout = true) {
  if (password.length < 8) throw new VendorDataError("Vendor passwords must be at least 8 characters.", 400);
  const users = await rest<Array<{ id: string }>>("vendor_users", `vendor_id=eq.${encodeURIComponent(vendorId)}&select=id`, { privileged: true });
  if (!users[0]) throw new VendorDataError("Vendor login is not configured.", 404);
  await rest("vendor_users", `id=eq.${encodeURIComponent(users[0].id)}`, { privileged: true, method: "PATCH", body: { password_hash: await passwordDigest(password), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() } });
  if (forceLogout) {
    const vendors = await rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(vendorId)}&select=session_version`, { privileged: true });
    await rest("vendors", `id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: { session_version: (vendors[0]?.session_version || 1) + 1, updated_at: new Date().toISOString() } });
    await rest("vendor_sessions", `vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "DELETE" });
  }
  await audit("admin", actorId, vendorId, "vendor.password_reset", "vendor", vendorId, { forceLogout });
}

export async function forceLogoutVendor(vendorId: string, actorId: string) {
  const vendors = await rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(vendorId)}&select=session_version`, { privileged: true });
  if (!vendors[0]) throw new VendorDataError("Vendor not found.", 404);
  await rest("vendors", `id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: { session_version: vendors[0].session_version + 1, updated_at: new Date().toISOString() } });
  await rest("vendor_sessions", `vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "DELETE" });
  await audit("admin", actorId, vendorId, "vendor.force_logout", "vendor", vendorId);
}

export async function listPublicVendors() {
  const vendors = await rest<VendorRecord[]>("vendors", "status=eq.Active&store_visibility=eq.Visible&select=id,slug,business_name,logo_url,cover_url,description,featured&order=featured.desc,business_name.asc");
  return vendors.map((vendor) => ({ id: vendor.id, slug: vendor.slug, businessName: vendor.business_name, logoUrl: vendor.logo_url || undefined, coverUrl: vendor.cover_url || undefined, description: vendor.description, featured: vendor.featured }));
}

export async function getPublicVendor(slug: string) {
  const vendors = await rest<VendorRecord[]>("vendors", `slug=eq.${encodeURIComponent(slug)}&status=eq.Active&store_visibility=eq.Visible&select=id,slug,business_name,logo_url,cover_url,description,featured`);
  const vendor = vendors[0];
  if (!vendor) throw new VendorDataError("Vendor store not found.", 404);
  const products = await rest<Array<Record<string, unknown>>>("products", `vendor_id=eq.${encodeURIComponent(vendor.id)}&vendor_status=eq.Approved&public_vendor_visible=eq.true&select=*&order=created_at.desc`);
  return { vendor: { id: vendor.id, slug: vendor.slug, businessName: vendor.business_name, logoUrl: vendor.logo_url || undefined, coverUrl: vendor.cover_url || undefined, description: vendor.description, featured: vendor.featured }, products };
}

export async function listVendorsForAdmin() {
  const vendors = await rest<VendorRecord[]>("vendors", "select=*&order=created_at.desc", { privileged: true });
  return vendors.map(({ ...vendor }) => vendor);
}

export async function updateVendorAdmin(vendorId: string, data: Record<string, unknown>, actorId: string) {
  if (data.status !== undefined && !["Active", "Suspended", "Inactive"].includes(String(data.status))) throw new VendorDataError("Invalid vendor account status.", 400);
  if (data.storeVisibility !== undefined && !["Visible", "Hidden"].includes(String(data.storeVisibility))) throw new VendorDataError("Invalid store visibility.", 400);
  const allowed: Record<string, unknown> = {};
  const fields: Array<[string, string]> = [["businessName", "business_name"], ["ownerName", "owner_name"], ["phone", "phone"], ["whatsappNumber", "whatsapp"], ["description", "description"], ["address", "address"], ["city", "city"], ["state", "state"], ["pinCode", "pin_code"], ["gstNumber", "gst_number"], ["panNumber", "pan_number"], ["logoUrl", "logo_url"], ["coverUrl", "cover_url"], ["status", "status"], ["storeVisibility", "store_visibility"], ["featured", "featured"], ["automaticApproval", "automatic_approval"], ["commissionMode", "commission_mode"], ["commissionPercentage", "commission_rate"], ["commissionFixed", "commission_fixed"]];
  for (const [input, output] of fields) if (data[input] !== undefined) allowed[output] = ["featured", "automatic_approval"].includes(output) ? Boolean(data[input]) : ["commission_rate", "commission_fixed"].includes(output) ? Number(data[input]) || 0 : data[input];
  allowed.updated_at = new Date().toISOString();
  const rows = await rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: allowed, headers: { Prefer: "return=representation" } });
  if (!rows[0]) throw new VendorDataError("Vendor not found.", 404);
  if (allowed.store_visibility !== undefined) {
    await rest("products", `vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: { public_vendor_visible: allowed.store_visibility === "Visible", updated_at: new Date().toISOString() } });
  }
  await audit("admin", actorId, vendorId, "vendor.updated", "vendor", vendorId, { changedFields: Object.keys(allowed).filter((key) => key !== "updated_at") });
  return rows[0];
}

export async function getVendorProducts(vendorId: string, privileged = true) {
  return rest<Array<Record<string, unknown>>>("products", `vendor_id=eq.${encodeURIComponent(vendorId)}&select=*&order=created_at.desc`, { privileged });
}

export async function saveVendorProduct(vendorId: string, data: Record<string, unknown>, admin = false) {
  const sku = String(data.sku || "").trim();
  if (!sku || !String(data.name || "").trim()) throw new VendorDataError("Product name and SKU are required.", 400);
  const skuRows = await rest<Array<{ sku: string; vendor_id?: string | null }>>("products", `sku=eq.${encodeURIComponent(sku)}&select=sku,vendor_id`, { privileged: true });
  if (skuRows[0] && skuRows[0].vendor_id !== vendorId) throw new VendorDataError("This SKU already belongs to another catalog product.", 409);
  const vendorRows = await rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(vendorId)}&select=id,status,automatic_approval`, { privileged: true });
  const vendor = vendorRows[0];
  if (!vendor) throw new VendorDataError("Vendor not found.", 404);
  const requestedStatus = String(data.vendor_status || "Draft") as VendorProductStatus;
  const vendorStatus = admin ? requestedStatus : vendor.automatic_approval ? "Approved" : requestedStatus === "Approved" ? "Pending Approval" : requestedStatus;
  const rows = await rest<Array<Record<string, unknown>>>("products", "", { privileged: true, method: "POST", body: [{ sku, name: String(data.name).trim(), category: String(data.category || "Uncategorised").trim(), stock: Math.max(0, Math.floor(Number(data.stock) || 0)), price: Math.max(0, Number(data.price) || 0), cost: Math.max(0, Number(data.cost) || 0), status: vendorStatus === "Approved" ? "Published" : "Draft", image: String(data.image || ""), hover_image: String(data.hover_image || data.image || ""), compare_at: data.compare_at == null ? null : Number(data.compare_at), tag: data.tag || null, tone: data.tone || null, vendor_id: vendorId, vendor_status: vendorStatus, vendor_rejection_reason: data.vendor_rejection_reason || null, public_vendor_visible: vendorStatus === "Approved", low_stock_limit: Math.max(0, Math.floor(Number(data.low_stock_limit) || 5)), updated_at: new Date().toISOString() }], headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
  return rows[0];
}

export async function updateVendorProduct(vendorId: string, sku: string, data: Record<string, unknown>, admin = false) {
  const existing = await rest<Array<Record<string, unknown>>>("products", `sku=eq.${encodeURIComponent(sku)}&vendor_id=eq.${encodeURIComponent(vendorId)}&select=sku,vendor_status`, { privileged: true });
  if (!existing[0]) throw new VendorDataError("Product not found for this vendor.", 404);
  const patch: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  if (!admin) {
    delete patch.vendor_id; delete patch.vendor_status; delete patch.public_vendor_visible;
    if (data.vendor_status === "Approved") patch.vendor_status = "Pending Approval";
  }
  const rows = await rest<Array<Record<string, unknown>>>("products", `sku=eq.${encodeURIComponent(sku)}&vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: patch, headers: { Prefer: "return=representation" } });
  return rows[0];
}

export async function reviewVendorProduct(vendorId: string, sku: string, decision: "Approved" | "Rejected" | "Inactive", reason: string | undefined, actorId: string) {
  if (decision === "Rejected" && !reason?.trim()) throw new VendorDataError("A rejection reason is required.", 400);
  const rows = await rest<Array<Record<string, unknown>>>("products", `sku=eq.${encodeURIComponent(sku)}&vendor_id=eq.${encodeURIComponent(vendorId)}&select=sku`, { privileged: true });
  if (!rows[0]) throw new VendorDataError("Vendor product not found.", 404);
  const productRows = await rest<Array<Record<string, unknown>>>("products", `sku=eq.${encodeURIComponent(sku)}&vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: { vendor_status: decision, vendor_rejection_reason: decision === "Rejected" ? reason?.trim() : null, public_vendor_visible: decision === "Approved", status: decision === "Approved" ? "Published" : "Draft", updated_at: new Date().toISOString() }, headers: { Prefer: "return=representation" } });
  await audit("admin", actorId, vendorId, `vendor.product_${decision.toLowerCase()}`, "product", sku, decision === "Rejected" ? { reason: reason?.trim() } : {});
  await rest("vendor_notifications", "", { privileged: true, method: "POST", body: [{ vendor_id: vendorId, kind: decision === "Approved" ? "product_approved" : "product_rejected", title: `Product ${decision.toLowerCase()}`, body: decision === "Rejected" ? `Product ${sku} was rejected: ${reason?.trim()}` : `Product ${sku} is now approved.` }] }).catch(() => undefined);
  return productRows[0];
}

export async function getVendorDashboard(vendorId: string) {
  const [vendorRows, products, orders, payouts, notifications, categoryRows, offerRows] = await Promise.all([
    rest<VendorRecord[]>("vendors", `id=eq.${encodeURIComponent(vendorId)}&select=*`, { privileged: true }),
    getVendorProducts(vendorId),
    rest<Array<Record<string, unknown>>>("vendor_orders", `vendor_id=eq.${encodeURIComponent(vendorId)}&select=*&order=created_at.desc`, { privileged: true }),
    rest<Array<Record<string, unknown>>>("vendor_payouts", `vendor_id=eq.${encodeURIComponent(vendorId)}&select=*&order=created_at.desc`, { privileged: true }),
    rest<Array<Record<string, unknown>>>("vendor_notifications", `vendor_id=eq.${encodeURIComponent(vendorId)}&select=id,kind,title,body,read_at,created_at&order=created_at.desc&limit=20`, { privileged: true }),
    rest<Array<{ name?: string }>>("categories", "select=name&order=sort_order.asc", { privileged: true }).catch(() => []),
    rest<Array<{ value?: string }>>("store_settings", "key=eq.promotional_offers&select=value", { privileged: true }).catch(() => []),
  ]);
  let offers: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(offerRows[0]?.value || "[]") as unknown;
    if (Array.isArray(parsed)) offers = parsed.filter((offer): offer is Record<string, unknown> => Boolean(offer && typeof offer === "object"));
  } catch {
    offers = [];
  }
  const amount = (value: unknown) => Number(value) || 0;
  const gross = orders.reduce((sum, order) => sum + amount(order.gross_product_amount), 0);
  const commission = orders.reduce((sum, order) => sum + amount(order.commission_amount), 0);
  const net = orders.reduce((sum, order) => sum + amount(order.vendor_net_amount), 0);
  const statuses = (status: string) => orders.filter((order) => order.status === status).length;
  return { vendor: vendorRows[0], products, orders, payouts, notifications, categories: categoryRows.map((category) => String(category.name || "")).filter(Boolean), offers, stats: { grossSales: gross, commission, netEarnings: net, totalOrders: orders.length, newOrders: statuses("New"), processingOrders: statuses("Processing"), deliveredOrders: statuses("Delivered"), cancelledOrders: statuses("Cancelled"), returnedOrders: statuses("Returned"), totalProducts: products.length, activeProducts: products.filter((product) => product.vendor_status === "Approved").length, lowStockProducts: products.filter((product) => Number(product.stock) <= Number(product.low_stock_limit || 5)).length, outOfStockProducts: products.filter((product) => Number(product.stock) <= 0).length } };
}

export async function updateVendorOrder(vendorId: string, orderId: string, status: VendorOrderStatus, courier?: { name?: string; awb?: string; url?: string }) {
  const allowed: VendorOrderStatus[] = ["Accepted", "Processing", "Ready to Ship", "Shipped"];
  if (!allowed.includes(status)) throw new VendorDataError("This order status requires admin action.", 403);
  const rows = await rest<Array<Record<string, unknown>>>("vendor_orders", `id=eq.${encodeURIComponent(orderId)}&vendor_id=eq.${encodeURIComponent(vendorId)}&select=id,status`, { privileged: true });
  if (!rows[0]) throw new VendorDataError("Order not found for this vendor.", 404);
  const updated = await rest<Array<Record<string, unknown>>>("vendor_orders", `id=eq.${encodeURIComponent(orderId)}&vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: { status, ...(courier?.name ? { courier_name: courier.name } : {}), ...(courier?.awb ? { tracking_number: courier.awb } : {}), ...(courier?.url ? { tracking_url: courier.url } : {}), updated_at: new Date().toISOString() }, headers: { Prefer: "return=representation" } });
  await rest("vendor_order_status_history", "", { privileged: true, method: "POST", body: [{ vendor_order_id: orderId, actor_type: "vendor", actor_id: vendorId, from_status: rows[0].status, to_status: status, metadata: courier || {} }] }).catch(() => undefined);
  await audit("vendor", vendorId, vendorId, "vendor.order_status_changed", "vendor_order", orderId, { fromStatus: rows[0].status, toStatus: status });
  return updated;
}

export async function listVendorPayouts(vendorId: string) {
  return rest<Array<Record<string, unknown>>>("vendor_payouts", `vendor_id=eq.${encodeURIComponent(vendorId)}&select=*&order=created_at.desc`, { privileged: true });
}

export async function createVendorPayout(vendorId: string, orderIds: string[], details: { paymentMethod?: string; transactionReference?: string; amount?: number; status?: string; adjustmentAmount?: number; adjustmentReason?: string }, actorId: string) {
  const ids = Array.from(new Set(orderIds.filter(Boolean)));
  if (!ids.length) throw new VendorDataError("Select at least one delivered vendor order.", 400);
  const orders = await rest<Array<Record<string, unknown>>>("vendor_orders", `vendor_id=eq.${encodeURIComponent(vendorId)}&id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})&select=id,status,payout_status,vendor_net_amount`, { privileged: true });
  if (orders.length !== ids.length || orders.some((order) => order.status !== "Delivered")) throw new VendorDataError("Only delivered vendor orders can be included in a payout.", 400);
  const alreadyPaid = await rest<Array<{ vendor_order_id: string }>>("vendor_payout_items", `vendor_order_id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})&select=vendor_order_id`, { privileged: true });
  if (alreadyPaid.length) throw new VendorDataError("One or more selected orders are already included in a payout.", 409);
  const baseAmount = orders.reduce((sum, order) => sum + (Number(order.vendor_net_amount) || 0), 0);
  const adjustment = Number(details.adjustmentAmount) || 0;
  if (adjustment && !details.adjustmentReason?.trim()) throw new VendorDataError("A reason is required for a payout adjustment.", 400);
  const amount = Math.max(0, Number(details.amount ?? baseAmount + adjustment) || 0);
  const payoutNumber = `VP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const payouts = await rest<Array<{ id: string; payout_number: string }>>("vendor_payouts", "", { privileged: true, method: "POST", body: [{ vendor_id: vendorId, payout_number: payoutNumber, status: details.status || "Approved", amount, payment_method: details.paymentMethod || "", transaction_reference: details.transactionReference || null, payout_date: new Date().toISOString(), adjustment_amount: adjustment, adjustment_reason: details.adjustmentReason?.trim() || null }], headers: { Prefer: "return=representation" } });
  const payout = payouts[0];
  if (!payout) throw new VendorDataError("Payout could not be created.");
  try {
    await rest("vendor_payout_items", "", { privileged: true, method: "POST", body: orders.map((order) => ({ payout_id: payout.id, vendor_order_id: order.id, amount: Number(order.vendor_net_amount) || 0 })) });
    await rest("vendor_orders", `id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})&vendor_id=eq.${encodeURIComponent(vendorId)}`, { privileged: true, method: "PATCH", body: { payout_status: details.status || "Approved", updated_at: new Date().toISOString() } });
  } catch (error) {
    await rest("vendor_payouts", `id=eq.${encodeURIComponent(payout.id)}`, { privileged: true, method: "DELETE" }).catch(() => undefined);
    throw error;
  }
  await audit("admin", actorId, vendorId, "vendor.payout_created", "payout", payout.id, { orderCount: orders.length, amount });
  await rest("vendor_notifications", "", { privileged: true, method: "POST", body: [{ vendor_id: vendorId, kind: "payout_approved", title: "Payout approved", body: `Payout ${payoutNumber} for ₹${amount.toLocaleString("en-IN")} was approved.` }] }).catch(() => undefined);
  return payout;
}

const money = (value: unknown) => Number(String(value ?? "").replace(/[^0-9.-]/g, "")) || 0;
const normalizedProductKey = (value: unknown) => String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();

/**
 * Creates idempotent vendor sub-orders after the legacy order has been paid.
 * The legacy order remains the customer-facing source of truth; vendor tables
 * are an operational projection with immutable monetary snapshots.
 */
export async function syncVendorOrderForPaidOrder(order: { id: string; total: string; date?: string; status?: string; paymentStatus?: string; razorpayPaymentId?: string; couponDiscount?: number; promotionDiscount?: number; shippingTotal?: number; customerName?: string; phone?: string; email?: string; address?: string; items?: Array<Record<string, unknown>> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const products = await rest<Array<Record<string, unknown>>>("products", "select=sku,name,category,price,vendor_id,vendor_status,public_vendor_visible", { privileged: true });
  const vendors = await rest<VendorRecord[]>("vendors", "select=id,business_name,slug,status,store_visibility,commission_mode,commission_rate,commission_fixed", { privileged: true });
  const productMap: Record<string, { vendorId?: string | null; vendorName?: string; vendorSlug?: string; sku?: string; category?: string; price?: number }> = {};
  for (const product of products) {
    const vendor = vendors.find((candidate) => candidate.id === product.vendor_id);
    const value = { vendorId: (product.vendor_id as string | null | undefined) || null, vendorName: vendor?.business_name, vendorSlug: vendor?.slug, sku: String(product.sku || ""), category: String(product.category || ""), price: Number(product.price) || 0 };
    productMap[normalizedProductKey(product.sku)] = value;
    productMap[normalizedProductKey(String(product.sku || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"))] = value;
  }
  const rawItems = (order.items || []).map((item) => {
    const lookup = productMap[normalizedProductKey(item.productId)] || productMap[normalizedProductKey(item.sku)] || {};
    return { ...item, name: String(item.name || ""), quantity: Math.max(0, Number(item.quantity) || 0), price: String(item.price || "₹0"), sku: String(lookup.sku || item.sku || item.productId || ""), vendorId: typeof item.vendorId === "string" ? item.vendorId : lookup.vendorId ?? null, vendorName: typeof item.vendorName === "string" ? item.vendorName : lookup.vendorName, vendorSlug: typeof item.vendorSlug === "string" ? item.vendorSlug : lookup.vendorSlug, category: lookup.category };
  });
  const groups = groupOrderItemsByVendor({ id: order.id, total: order.total, items: rawItems }, productMap);
  const groupAmounts = groups.map((group) => group.items.reduce((sum, item) => sum + money(item.price) * Math.max(0, Number(item.quantity) || 0), 0));
  const couponGroupAllocations = allocateProRata(Number(order.couponDiscount) || 0, groupAmounts);
  const shippingGroupAllocations = allocateProRata(Number(order.shippingTotal) || 0, groupAmounts);
  const commissionRows = await rest<Array<Record<string, unknown>>>("vendor_commission_rules", "active=eq.true&select=scope_type,scope_id,mode,rate,fixed_amount", { privileged: true }).catch(() => []);
  const toRule = (row: Record<string, unknown> | undefined, source: CommissionRule["source"]): CommissionRule | undefined => row ? { source, mode: row.mode === "fixed" ? "fixed" : "percentage", rate: Number(row.rate) || 0, fixedAmount: Number(row.fixed_amount) || 0 } : undefined;
  const globalRule = toRule(commissionRows.find((row) => row.scope_type === "global"), "global") || { source: "global" as const, mode: "percentage" as const, rate: 0, fixedAmount: 0 };
  const now = new Date().toISOString();
  for (const group of groups) {
    const vendor = vendors.find((candidate) => candidate.id === group.vendorId);
    const itemAmounts = group.items.map((item) => money(item.price) * Math.max(0, Number(item.quantity) || 0));
    const regularAmounts = group.items.map((item, index) => Math.max(itemAmounts[index] || 0, (Number(item.regularPrice) || 0) * Math.max(0, Number(item.quantity) || 0)));
    const promotionDiscounts = regularAmounts.map((amount, index) => Math.max(0, amount - (itemAmounts[index] || 0)));
    const couponItemAllocations = allocateProRata(couponGroupAllocations[groups.indexOf(group)] || 0, itemAmounts);
    const discounts = promotionDiscounts.map((amount, index) => Math.round((amount + (couponItemAllocations[index] || 0)) * 100) / 100);
    const gross = regularAmounts.reduce((sum, amount) => sum + amount, 0);
    const shippingAmount = shippingGroupAllocations[groups.indexOf(group)] || 0;
    const vendorRule: CommissionRule = { source: "vendor", mode: vendor?.commission_mode === "fixed" ? "fixed" : "percentage", rate: Number(vendor?.commission_rate) || 0, fixedAmount: Number(vendor?.commission_fixed) || 0 };
    const itemCommissions = group.items.map((item, index) => {
      const product = productMap[normalizedProductKey(item.sku)] || {};
      const productRule = commissionRows.find((row) => row.scope_type === "product" && row.scope_id && normalizedProductKey(row.scope_id) === normalizedProductKey(product.sku));
      const categoryRule = commissionRows.find((row) => row.scope_type === "category" && row.scope_id && String(row.scope_id).toLowerCase() === String(product.category || "").toLowerCase());
      return calculateCommission({ grossProductAmount: itemAmounts[index] || 0, allocatedDiscount: discounts[index] || 0, rule: resolveCommissionRule({ product: toRule(productRule, "product"), category: toRule(categoryRule, "category"), vendor: group.vendorId ? vendorRule : undefined, global: globalRule }) });
    });
    const commission = { commissionAmount: itemCommissions.reduce((sum, item) => sum + item.commissionAmount, 0), vendorNetAmount: itemCommissions.reduce((sum, item) => sum + item.vendorNetAmount, 0), rule: itemCommissions[0]?.rule || globalRule };
    const existing = await rest<Array<{ id: string }>>("vendor_orders", `vendor_id=${group.vendorId ? `eq.${encodeURIComponent(group.vendorId)}` : "is.null"}&main_order_id=eq.${encodeURIComponent(order.id)}&select=id&limit=1`, { privileged: true });
    let vendorOrderId = existing[0]?.id;
    if (!vendorOrderId) {
      const subOrderNumber = `${order.id}-${group.vendorId ? String(vendor?.slug || group.vendorId).slice(0, 18).toUpperCase() : "PLATFORM"}`;
      const inserted = await rest<Array<{ id: string }>>("vendor_orders", "", { privileged: true, method: "POST", body: [{ vendor_id: group.vendorId, main_order_id: order.id, sub_order_number: subOrderNumber, order_date: order.date ? new Date(order.date).toISOString() : now, customer_snapshot: { name: order.customerName || "", phone: order.phone || "", email: order.email || "", address: order.address || "" }, gross_product_amount: gross, allocated_discount: discounts.reduce((sum, amount) => sum + amount, 0), tax_amount: 0, shipping_amount: shippingAmount, refund_amount: 0, commission_rate: commission.rule.mode === "percentage" ? commission.rule.rate : commission.rule.fixedAmount, commission_mode: commission.rule.mode, commission_amount: commission.commissionAmount, vendor_net_amount: commission.vendorNetAmount, commission_rule_snapshot: commission.rule, payout_status: "Not Eligible", status: "New", payment_method: order.razorpayPaymentId ? "Online" : "COD", payment_status: order.paymentStatus || "paid", payout_eligible_at: null, created_at: now, updated_at: now }], headers: { Prefer: "return=representation" } });
      vendorOrderId = inserted[0]?.id;
    }
    if (!vendorOrderId) continue;
    const existingItems = await rest<Array<{ id: string }>>("vendor_order_items", `vendor_order_id=eq.${encodeURIComponent(vendorOrderId)}&select=id&limit=1`, { privileged: true });
    if (!existingItems.length) {
      await rest("vendor_order_items", "", { privileged: true, method: "POST", body: group.items.map((item, index) => ({ vendor_order_id: vendorOrderId, product_sku: String(item.sku || item.productId || ""), product_name: item.name, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)), unit_price: money(item.price), allocated_discount: discounts[index] || 0, tax_amount: Number(item.tax) || 0, shipping_amount: Number(item.shipping) || 0, refund_amount: 0, commission_amount: itemCommissions[index]?.commissionAmount || 0, vendor_net_amount: itemCommissions[index]?.vendorNetAmount || 0, product_snapshot: item })) });
    }
    if (group.vendorId) {
      const notification = await rest("vendor_notifications", "", { privileged: true, method: "POST", body: [{ vendor_id: group.vendorId, kind: "new_order", title: "New order received", body: `Order ${order.id} includes ${group.items.length} item${group.items.length === 1 ? "" : "s"}.` }] }).catch(() => null);
      void notification;
    }
  }
}

export function jsonError(error: unknown) {
  const status = error instanceof VendorDataError ? error.status : 500;
  return { error: error instanceof VendorDataError ? error.message : "Vendor service is temporarily unavailable.", status };
}
