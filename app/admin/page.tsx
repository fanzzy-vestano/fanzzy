"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import {
  fetchCatalogCategories,
  fetchCatalogProducts,
  fetchStoreOrders,
  fetchStoreSetting,
  inferLegacyCategorySections,
  isSupabaseReady,
  removeCatalogCategory,
  removeCatalogProduct,
  renameCatalogCategory,
  saveCatalogCategory,
  saveCatalogProduct,
  saveStoreOrders,
  saveStoreSetting,
  subscribeToStoreSetting,
  type CatalogAgent,
  type ProductVariantType,
  uploadStoreImage,
} from "../../lib/supabase/catalog";
import { defaultBillDesignSettings, printOrderBill, type BillDesignSettings } from "../../lib/order-bill";
import { supabase } from "../../lib/supabase/client";
import {
  defaultPromotionForm,
  isPromotionLive,
  offerTypeLabel,
  normalizePromotionOffer,
  promotionStorageKey,
  type PromotionOffer,
  type PromotionOfferStatus,
  type PromotionSelection,
} from "../../lib/promotional-offers";
import "../globals.css";
import "../brand-polish.css";
import "./admin.css";
import "./admin-polish.css";
import AdminVendorsWorkspace from "./vendors-workspace";

type AdminProduct = {
  name: string;
  sku: string;
  createdAt?: string;
  category: string;
  stock: number;
  price: string;
  cost: string;
  status: "Published" | "Draft" | "Low stock";
  image: string;
  hoverImage?: string;
  compareAt?: number;
  barcode?: string;
  hsnCode?: string;
  billName?: string;
  supplierName?: string;
  gstRate?: number;
  markup?: number;
  costWithGst?: string;
  sizes?: string[];
  sizeStock?: Record<string, number>;
  variants?: ProductVariant[];
  variantType?: ProductVariantType;
  imageAdjustments?: ImageAdjustments;
  hoverImageAdjustments?: ImageAdjustments;
};
type ImageAdjustments = { zoom: number; x: number; y: number; rotate: number };
type ProductVariant = { name: string; size?: string; image: string; stock?: number; price?: number; adjustments?: ImageAdjustments };
type ProductImageAdjustments = {
  image?: ImageAdjustments;
  hoverImage?: ImageAdjustments;
  variants?: ImageAdjustments[];
};
type ProductDamageRecord = {
  id: string;
  sku: string;
  productName: string;
  quantity: number;
  reason: string;
  stockScope: string;
  createdAt: string;
};
type ProductDamageMap = Record<string, ProductDamageRecord[]>;
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
  offerType?: "bogo";
  buyQuantity?: number;
  getQuantity?: number;
  eligibleProductIds?: string[];
};
type DateRange = "today" | "this-month" | "last-month" | "all-time" | "custom";
type ProductFilter = "all" | "low-stock" | "drafts";
type OrderDateFilter =
  | "today"
  | "this-week"
  | "this-month"
  | "all-time"
  | "custom";
type ReportView = "overview" | "sales" | "category" | "item" | "top-selling" | "inventory" | "orders" | "damaged";
type AdminPermission =
  | "Overview"
  | "Products"
  | "Product Image Scanner"
  | "Categories"
  | "Collections"
   | "Orders"
   | "Refund requests"
   | "Customers"
  | "Agents"
  | "Marketing"
  | "Buy 1 Get X Free"
  | "Homepage"
  | "Delivery charge"
  | "Hub"
  | "Reports"
  | "Announcement"
  | "Settings"
  | "Vendors"
  | "Suppliers"
  | "Supplier Bills";
type SupplierRecord = { id: string; name: string; createdAt?: string; isDefault?: boolean };
type AdminRole = {
  id: string;
  name: string;
  title: string;
  permissions: AdminPermission[];
};
const allAdminPermissions: AdminPermission[] = [
  "Overview",
  "Products",
  "Product Image Scanner",
  "Categories",
  "Collections",
  "Orders",
  "Refund requests",
  "Customers",
  "Agents",
  "Marketing",
  "Buy 1 Get X Free",
  "Homepage",
  "Delivery charge",
  "Hub",
  "Reports",
  "Announcement",
  "Settings",
  "Vendors",
  "Suppliers",
  "Supplier Bills",
];
const defaultAdminRoles: AdminRole[] = [
  { id: "vestano", name: "Vestano", title: "Super admin", permissions: allAdminPermissions },
];

const adminProducts: AdminProduct[] = [];
const adminPlaceholderImage = "";
const demoProductNames = new Set([
  "aurora drop earrings",
  "solstice tennis necklace",
  "muse sculpted cuff",
  "orbital pearl ring",
]);
const isDemoProduct = (product: { name?: string; sku?: string }) =>
  demoProductNames.has(String(product.name ?? "").trim().toLowerCase()) ||
  /^LST-(AUR|SOL|MUS|ORB)-\d+$/i.test(String(product.sku ?? ""));
const defaultHeroImage = "";
const defaultCategoryImages: Record<string, string> = {};
const defaultHeroSlides: string[] = [];
const defaultHeroSlideDuration = 5.2;
const defaultDeliveryCharge = { enabled: false, amount: 99, freeAboveEnabled: false, freeAbove: 999 };
type PaymentSettings = { online: boolean; cod: boolean; provider: string; codCharge: number };
const defaultPaymentSettings: PaymentSettings = { online: true, cod: true, provider: "Razorpay", codCharge: 0 };
type RefundRequestStatus = "Requested" | "Approved" | "Rejected" | "Refunded";
type RefundRequest = {
  id: string;
  orderId: string;
  userId: string;
  customerName: string;
  phone: string;
  amount: string;
  status: RefundRequestStatus;
  reason: string;
  createdAt: string;
  updatedAt?: string;
};
const parseRefundRequests = (value: string | null | undefined): RefundRequest[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((request): request is Partial<RefundRequest> => Boolean(request && typeof request === "object"))
      .map((request, index) => ({
        id: typeof request.id === "string" && request.id ? request.id : `refund-${index + 1}`,
        orderId: typeof request.orderId === "string" ? request.orderId : "",
        userId: typeof request.userId === "string" ? request.userId : "",
        customerName: typeof request.customerName === "string" ? request.customerName : "Customer",
        phone: typeof request.phone === "string" ? request.phone : "",
        amount: typeof request.amount === "string" ? request.amount : "₹0",
        status: request.status === "Approved" || request.status === "Rejected" || request.status === "Refunded" ? request.status : "Requested",
        reason: typeof request.reason === "string" ? request.reason : "Customer requested a refund",
        createdAt: typeof request.createdAt === "string" ? request.createdAt : new Date().toISOString(),
        updatedAt: typeof request.updatedAt === "string" ? request.updatedAt : undefined,
      }))
      .filter((request) => request.orderId && request.userId);
  } catch {
    return [];
  }
};
const parsePaymentSettings = (value: unknown): PaymentSettings => {
  if (!value || typeof value !== "object") return defaultPaymentSettings;
  const parsed = value as Partial<PaymentSettings>;
  return {
    online: typeof parsed.online === "boolean" ? parsed.online : defaultPaymentSettings.online,
    cod: typeof parsed.cod === "boolean" ? parsed.cod : defaultPaymentSettings.cod,
    provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider.trim() : defaultPaymentSettings.provider,
    codCharge: Math.max(0, Number.isFinite(parsed.codCharge) ? Number(parsed.codCharge) : defaultPaymentSettings.codCharge),
  };
};
type PickupHub = { id: string; name: string; place: string };
const defaultPickupHubs: PickupHub[] = [];
const localSuppliersKey = "fanzzy-suppliers";
const preferredDefaultSupplierName = "Thrissur bill";
const parseSupplierRecords = (value: string | null | undefined): SupplierRecord[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((supplier): supplier is Partial<SupplierRecord> => Boolean(supplier && typeof supplier === "object"))
      .map((supplier, index) => ({
        id: typeof supplier.id === "string" && supplier.id ? supplier.id : `supplier-${index + 1}`,
        name: typeof supplier.name === "string" ? supplier.name.trim() : "",
        createdAt: typeof supplier.createdAt === "string" ? supplier.createdAt : undefined,
        isDefault: supplier.isDefault === true,
      }))
      .filter((supplier) => supplier.name);
  } catch {
    return [];
  }
};
const persistSuppliers = (suppliers: SupplierRecord[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localSuppliersKey, JSON.stringify(suppliers));
  window.dispatchEvent(new Event("fanzzy-suppliers-updated"));
};
const ensurePreferredSupplier = (suppliers: SupplierRecord[]) => {
  const preferredSupplier = suppliers.find(
    (supplier) => supplier.name.toLowerCase() === preferredDefaultSupplierName.toLowerCase(),
  );
  if (preferredSupplier) {
    if (suppliers.some((supplier) => supplier.isDefault)) return { suppliers, changed: false };
    return {
      suppliers: suppliers.map((supplier) => ({
        ...supplier,
        isDefault: supplier.id === preferredSupplier.id,
      })),
      changed: true,
    };
  }
  return {
    suppliers: [
      ...suppliers.map((supplier) => ({ ...supplier, isDefault: false })),
      { id: `supplier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: preferredDefaultSupplierName, createdAt: new Date().toISOString(), isDefault: true },
    ],
    changed: true,
  };
};
const parseAdminPickupHubs = (value: string | null | undefined): PickupHub[] => {
  if (!value) return defaultPickupHubs;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return defaultPickupHubs;
    return parsed
      .filter((hub): hub is Partial<PickupHub> => Boolean(hub && typeof hub === "object"))
      .map((hub, index) => ({
        id: typeof hub.id === "string" && hub.id ? hub.id : `hub-${index + 1}`,
        name: typeof hub.name === "string" ? hub.name.trim() : "",
        place: typeof hub.place === "string" ? hub.place.trim() : "",
      }))
      .filter((hub) => hub.name && hub.place);
  } catch {
    return defaultPickupHubs;
  }
};
const formatAdminCurrency = (value: number) => `₹${Math.max(0, Math.round(value)).toLocaleString("en-IN")}`;
const defaultMarketingRecords: MarketingRecord[] = [];
const defaultImageAdjustments: ImageAdjustments = { zoom: 1, x: 0, y: 0, rotate: 0 };
const normalizeImageAdjustments = (value: unknown): ImageAdjustments => {
  const source = value && typeof value === "object" ? value as Partial<ImageAdjustments> : {};
  const numberOr = (candidate: unknown, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
  return {
    zoom: Math.min(2, Math.max(1, numberOr(source.zoom, 1))),
    x: Math.min(50, Math.max(-50, numberOr(source.x, 0))),
    y: Math.min(50, Math.max(-50, numberOr(source.y, 0))),
    rotate: Math.min(180, Math.max(-180, numberOr(source.rotate, 0))),
  };
};
const imageTransformStyle = (adjustments: ImageAdjustments) => {
  const safe = normalizeImageAdjustments(adjustments);
  const translation = safe.zoom - 1;
  return {
    objectFit: "cover" as const,
    objectPosition: "50% 50%",
    transform: `translate(${safe.x * translation}%, ${safe.y * translation}%) scale(${safe.zoom}) rotate(${safe.rotate}deg)`,
    transformOrigin: "center center",
  };
};
const hasImageAdjustments = (value?: ImageAdjustments) => {
  const adjustments = normalizeImageAdjustments(value);
  return adjustments.zoom !== 1 || adjustments.x !== 0 || adjustments.y !== 0 || adjustments.rotate !== 0;
};
function ImageAdjustmentPreview({
  src,
  alt,
  adjustments,
  onChange,
  onClick,
  enabled = true,
  className = "",
}: {
  src: string;
  alt: string;
  adjustments: ImageAdjustments;
  onChange: (next: ImageAdjustments) => void;
  onClick?: () => void;
  enabled?: boolean;
  className?: string;
}) {
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const dragged = useRef(false);
  return (
    <div
      className={`adjustment-preview ${enabled ? "" : "adjustment-preview-disabled"} ${className}`}
      onPointerDown={(event) => {
        dragged.current = false;
        if (!enabled) return;
        drag.current = { pointerId: event.pointerId, x: adjustments.x, y: adjustments.y, startX: event.clientX, startY: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        if (event.clientX !== start.startX || event.clientY !== start.startY) dragged.current = true;
        onChange({
          ...adjustments,
          x: Math.min(50, Math.max(-50, start.x + (event.clientX - start.startX))),
          y: Math.min(50, Math.max(-50, start.y + (event.clientY - start.startY))),
        });
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onClick={() => { if (!dragged.current) onClick?.(); dragged.current = false; }}
      title={enabled ? "Drag to position the image" : "Photo adjustment is disabled"}
    >
      {src ? <img src={src} alt={alt} draggable={false} style={imageTransformStyle(adjustments)} /> : <strong className="adjustment-preview-empty">Upload image</strong>}
      {src && <span>{enabled ? "Drag" : "Adjustment off"}</span>}
    </div>
  );
}
function ImageAdjustmentControls({
  adjustments,
  onChange,
}: {
  adjustments: ImageAdjustments;
  onChange: (next: ImageAdjustments) => void;
}) {
  const update = (field: keyof ImageAdjustments, value: string) =>
    onChange({ ...adjustments, [field]: Number(value) });
  return (
    <div className="image-adjustment-controls">
      <label>Zoom <input type="range" min="1" max="2" step="0.05" value={adjustments.zoom} onChange={(event) => update("zoom", event.target.value)} /></label>
      <label>Horizontal <input type="range" min="-50" max="50" value={adjustments.x} onChange={(event) => update("x", event.target.value)} /></label>
      <label>Vertical <input type="range" min="-50" max="50" value={adjustments.y} onChange={(event) => update("y", event.target.value)} /></label>
      <label>Rotate <input type="range" min="-180" max="180" value={adjustments.rotate} onChange={(event) => update("rotate", event.target.value)} /></label>
      <button type="button" onClick={() => onChange(defaultImageAdjustments)}>Reset</button>
    </div>
  );
}
function PhotoAdjustmentToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <label className="photo-adjustment-toggle">
      <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>Enable photo adjustment</strong>
        <small>Turn on only when this image needs repositioning, zoom or rotation.</small>
      </span>
    </label>
  );
}
function VariantAdjustmentToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <label className="variant-adjustment-toggle">
      <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
      <span>Variant photo adjustments</span>
      <strong>{enabled ? "ON" : "OFF"}</strong>
    </label>
  );
}
type OrderStatus =
  | "Processing"
  | "Packed"
  | "Shipped"
  | "Delivered"
  | "Cancelled";
type OrderStatusFilter = "all" | OrderStatus;
type PromotionCartLine = { groupId: string; offerId: string; role: "paid" | "free" | "bundle"; label: string; regularPrice: number; linePrice: number };
type OrderRecord = {
  id: string;
  invoiceNumber?: string;
  date: string;
  createdAt?: string;
  status: OrderStatus;
  total: string;
  customerName: string;
  userId?: string;
  userPhone?: string;
  userEmail?: string;
  phone: string;
  email?: string;
  address?: string;
  fulfillmentMethod?: "delivery" | "pickup";
  pickupHubId?: string;
  pickupHubName?: string;
  pickupHubPlace?: string;
  coupon?: string;
  couponDiscount?: number;
  paymentStatus?: "pending" | "paid" | "cod_pending" | "cod_collected";
  paymentMethod?: "online" | "cod";
  codCharge?: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  inventoryAdjusted?: boolean;
  delhiveryAwb?: string;
  delhiveryTrackingUrl?: string;
  delhiveryShipmentStatus?: "pending" | "created" | "failed" | "skipped";
  delhiveryShipmentError?: string;
  delhiveryShipmentCreatedAt?: string;
  delhiveryPickupRequestStatus?: "pending" | "created" | "covered" | "failed" | "skipped";
  delhiveryPickupRequestId?: string;
  delhiveryPickupRequestDate?: string;
  delhiveryPickupRequestTime?: string;
  delhiveryPickupExpectedPackageCount?: number;
  delhiveryPickupRequestError?: string;
  delhiveryLiveStatus?: string;
  delhiveryLiveStatusType?: string;
  delhiveryLiveStatusDate?: string;
  delhiveryLiveLocation?: string;
  delhiveryLastTrackedAt?: string;
  items?: Array<{ name: string; quantity: number; price: string; productId?: string; image?: string; variantName?: string; variantImage?: string; size?: string; promotion?: PromotionCartLine }>;
};
const adminOrders: OrderRecord[] = [];
const isDemoOrder = (order: { id?: string }) => /^#FZ-104[4-8]$/.test(String(order.id ?? ""));
// Only verified payments belong in the operational Orders and Reports views.
// Pending checkout records remain stored for payment recovery but stay hidden.
const hasConfirmedPayment = (order: Pick<OrderRecord, "paymentStatus" | "razorpayPaymentId">) => order.paymentStatus === "paid" || order.paymentStatus === "cod_pending" || order.paymentStatus === "cod_collected" || Boolean(order.razorpayPaymentId);
const orderListsEqual = (left: OrderRecord[], right: OrderRecord[]) => left.length === right.length && left.every((order, index) => order.id === right[index]?.id && JSON.stringify(order) === JSON.stringify(right[index]));
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
const parseMoney = (value: string) => Number(value.replace(/[^0-9.]/g, "")) || 0;
const formatMoney = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return `₹${rounded.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};
const calculatePricing = (costValue: string, gstValue: string, markupValue: string) => {
  const cost = parseMoney(costValue);
  const gst = Number(gstValue) || 0;
  const markup = Number(markupValue) || 0;
  const costWithGst = cost > 0 ? cost * (1 + gst / 100) : 0;
  return {
    costWithGst: costWithGst > 0 ? formatMoney(costWithGst) : "₹",
    price: costWithGst > 0 ? formatMoney(costWithGst * (1 + markup / 100)) : "₹",
  };
};
const calculateMarkupFromSellingPrice = (costValue: string, gstValue: string, priceValue: string) => {
  const cost = parseMoney(costValue);
  const gst = Number(gstValue) || 0;
  const price = parseMoney(priceValue);
  const costWithGst = cost * (1 + gst / 100);
  return costWithGst > 0 && price > 0 ? String(Math.round(((price / costWithGst - 1) * 100) * 100) / 100) : "";
};
const normalizeSellingPriceForMargin = (costValue: string | number, priceValue: string | number) => {
  const cost = parseMoney(String(costValue));
  const price = parseMoney(String(priceValue));
  if (price <= 0) return String(priceValue || "₹0");
  if (cost > 0 && ((price - cost) / price) * 100 < 50) return formatAdminCurrency(Math.ceil(cost * 2));
  return formatAdminCurrency(Math.round(price));
};
const normalizeWholeSellingPrice = (priceValue: string | number) => {
  const price = parseMoney(String(priceValue));
  return price > 0 ? formatAdminCurrency(Math.round(price)) : String(priceValue || "₹0");
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

const localImageToFile = async (source: string, name: string) => {
  const response = await fetch(source);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/webp" });
};
const localProductVariantsKey = "fanzzy-product-variants";
const localProductDamagesKey = "fanzzy-product-damages";
const parseProductSizes = (value: string) => Array.from(new Set(value.split(",").map((size) => size.trim()).filter(Boolean)));
const normalizeSizeStock = (value: Record<string, number | ""> | undefined): Record<string, number> =>
  Object.fromEntries(Object.entries(value || {}).filter(([, quantity]) => quantity !== "" && Number.isFinite(Number(quantity))).map(([size, quantity]) => [size, Math.max(0, Math.floor(Number(quantity)))]));
const hasSellableStock = (stock: string | number, variantType: ProductVariantType, sizes: string[], sizeStock: Record<string, number | ""> | undefined, variants: ProductVariant[]) => {
  if (variantType === "normal" && variants.length) return variants.some((variant) => Number(variant.stock) > 0);
  if (variantType === "size" && sizes.length) return sizes.some((size) => Number(sizeStock?.[size]) > 0);
  return Number(stock) > 0;
};
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
    compareAt: product.compareAt,
    image: product.image,
    hoverImage: product.hoverImage || product.image,
    barcode: product.barcode || "",
    hsnCode: product.hsnCode || "",
    billName: product.billName || "",
    supplierName: product.supplierName || "",
    gstRate: product.gstRate || 0,
    markup: product.markup || 0,
    costWithGst: product.costWithGst || product.cost,
    sizes: product.sizes || [],
    sizeStock: product.sizeStock || {},
    variants: product.variants || [],
    variantType: product.variantType || (product.sizes?.length ? "size" : "normal"),
    imageAdjustments: product.imageAdjustments || defaultImageAdjustments,
    hoverImageAdjustments: product.hoverImageAdjustments || defaultImageAdjustments,
    tag: product.status === "Draft" ? "Draft" : undefined,
    tone: tones[index % tones.length],
  }));
  const localVariants = Object.fromEntries(
    storefrontCatalog
      .filter((product) => product.variants.length)
      .flatMap((product) => [
        [product.sku, product.variants],
        [product.id, product.variants],
      ]),
  );
  try {
    window.localStorage.setItem(localProductVariantsKey, JSON.stringify(localVariants));
  } catch {
    // The main catalog persistence below still has its own compact fallback.
  }
  try {
    window.localStorage.setItem(
      "fanzzy-products",
      JSON.stringify(storefrontCatalog),
    );
  } catch {
    // A large data URL must never crash the admin page when local storage is full.
    const compactCatalog = storefrontCatalog.map((product) => ({
      ...product,
      image: product.image.startsWith("data:") ? "" : product.image,
      hoverImage: product.hoverImage.startsWith("data:") ? "" : product.hoverImage,
      variants: product.variants.map((variant) => ({
        ...variant,
        image: variant.image.startsWith("data:") ? "" : variant.image,
      })),
    }));
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
const persistProductDamages = (damages: ProductDamageMap) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localProductDamagesKey, JSON.stringify(damages));
  } catch {
    // Product images can fill localStorage; damage history remains in React/Supabase.
  }
  window.dispatchEvent(new Event("fanzzy-product-damages-updated"));
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
  compareAt: product.compareAt,
  sizes: product.sizes || [],
  variants: product.variants || [],
  imageAdjustments: product.imageAdjustments || defaultImageAdjustments,
  hoverImageAdjustments: product.hoverImageAdjustments || defaultImageAdjustments,
});
const saveProductBarcodes = async (catalog: AdminProduct[]) => {
  const barcodes = Object.fromEntries(
    catalog
      .filter((product) => product.sku && product.barcode?.trim())
      .map((product) => [product.sku, product.barcode!.trim()]),
  );
  await saveStoreSetting("productBarcodes", JSON.stringify(barcodes));
};
const saveProductHsnCodes = async (catalog: AdminProduct[]) => {
  const hsnCodes = Object.fromEntries(
    catalog
      .filter((product) => product.sku && product.hsnCode?.trim())
      .map((product) => [product.sku, product.hsnCode!.trim()]),
  );
  await saveStoreSetting("productHsnCodes", JSON.stringify(hsnCodes));
};
const saveProductBillNames = async (catalog: AdminProduct[]) => {
  const billNames = Object.fromEntries(
    catalog
      .filter((product) => product.sku && product.billName?.trim())
      .map((product) => [product.sku, product.billName!.trim()]),
  );
  await saveStoreSetting("productBillNames", JSON.stringify(billNames));
};
const saveProductSupplierNames = async (catalog: AdminProduct[]) => {
  const supplierNames = Object.fromEntries(
    catalog
      .filter((product) => product.sku && product.supplierName?.trim())
      .map((product) => [product.sku, product.supplierName!.trim()]),
  );
  await saveStoreSetting("productSupplierNames", JSON.stringify(supplierNames));
};
const saveProductPricing = async (catalog: AdminProduct[]) => {
  const pricing = Object.fromEntries(
    catalog
      .filter((product) => product.sku)
      .map((product) => [product.sku, { gstRate: product.gstRate || 0, markup: product.markup || 0 }]),
  );
  await saveStoreSetting("productPricing", JSON.stringify(pricing));
};
const saveProductVariants = async (catalog: AdminProduct[]) => {
  const variants = Object.fromEntries(
    catalog
      .filter((product) => product.sku && product.variants?.length)
      .map((product) => [product.sku, product.variants]),
  );
  await saveStoreSetting("productVariants", JSON.stringify(variants));
};
const saveProductVariantTypes = async (catalog: AdminProduct[]) => {
  const variantTypes = Object.fromEntries(
    catalog
      .filter((product) => product.sku)
      .map((product) => [product.sku, product.variantType || (product.sizes?.length ? "size" : "normal")]),
  );
  await saveStoreSetting("productVariantType", JSON.stringify(variantTypes));
};
const saveProductSizes = async (catalog: AdminProduct[]) => {
  const sizes = Object.fromEntries(
    catalog
      .filter((product) => product.sku && product.sizes?.length)
      .map((product) => [product.sku, product.sizes]),
  );
  await saveStoreSetting("productSizes", JSON.stringify(sizes));
};
const saveProductSizeStock = async (catalog: AdminProduct[]) => {
  const stock = Object.fromEntries(
    catalog.filter((product) => product.sku && product.sizes?.length).map((product) => [product.sku, product.sizeStock || {}]),
  );
  await saveStoreSetting("productSizeStock", JSON.stringify(stock));
};
const saveProductImageAdjustments = async (catalog: AdminProduct[]) => {
  const adjustments = Object.fromEntries(
    catalog
      .filter((product) => product.sku)
      .map((product) => [product.sku, {
        image: normalizeImageAdjustments(product.imageAdjustments),
        hoverImage: normalizeImageAdjustments(product.hoverImageAdjustments),
        variants: (product.variants || []).map((variant) => normalizeImageAdjustments(variant.adjustments)),
      }]),
  );
  await saveStoreSetting("productImageAdjustments", JSON.stringify(adjustments));
};
const persistCategories = (
  categories: Array<{ name: string; pieces: number; image?: string; section?: CategorySection }>,
) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("fanzzy-categories", JSON.stringify(categories));
  void saveStoreSetting("categoryCatalog", JSON.stringify(categories));
  window.dispatchEvent(new Event("fanzzy-categories-updated"));
};
const menu = [
  { label: "Overview", icon: "◌" },
  { label: "Products", icon: "◇", count: "24" },
  { label: "Supplier Bills", icon: "▥" },
  { label: "Suppliers", icon: "▤" },
  { label: "Categories", icon: "▦" },
  { label: "Collections", icon: "✧" },
  { label: "Orders", icon: "↗" },
  { label: "Refund requests", icon: "↩" },
  { label: "Customers", icon: "♧" },
  { label: "Agents", icon: "✦" },
  { label: "Marketing", icon: "◈" },
  { label: "Buy 1 Get X Free", icon: "✦" },
  { label: "Homepage", icon: "⌂" },
  { label: "Delivery charge", icon: "₹" },
  { label: "Hub", icon: "⌖" },
  { label: "Reports", icon: "▥" },
  { label: "Announcement", icon: "▤" },
  { label: "Vendors", icon: "♢" },
];

type AdminAuthResponse = { authenticated?: boolean; error?: string; message?: string; resetReady?: boolean };
const isGitHubPagesHost = () =>
  typeof window !== "undefined" &&
  window.location.hostname.endsWith(".github.io");
const staticAdminEmail = process.env.NEXT_PUBLIC_STATIC_ADMIN_EMAIL ?? "";
const staticAdminPassword = process.env.NEXT_PUBLIC_STATIC_ADMIN_PASSWORD ?? "";
const adminRecoveryEmail = (staticAdminEmail || "fanzzy@vestanoretail.com").trim().toLowerCase();
const staticAdminSessionKey = "fanzzy-github-pages-admin-authenticated";
const hasStaticAdminSession = () =>
  typeof window !== "undefined" &&
  window.localStorage.getItem(staticAdminSessionKey) === "true";
const readAdminAuthResponse = async (response: Response): Promise<AdminAuthResponse> => {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AdminAuthResponse;
  } catch {
    return {};
  }
};
const adminApiUnavailableMessage = (status: number) =>
  status === 404 || status === 405
    ? "Admin login API is unavailable. Run the app locally with pnpm dev."
    : "Could not connect to admin login. Check that the local server is running.";

function AdminLoginGate() {
  const staticPagesMode = isGitHubPagesHost();
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authView, setAuthView] = useState<"login" | "forgot" | "reset">(() => {
    if (typeof window === "undefined") return "login";
    const params = new URLSearchParams(window.location.search);
    // Supabase sends these parameters when a recovery link is stale, already
    // used, or was consumed by a mail scanner. Do not show a verified reset
    // form for an invalid recovery attempt.
    if (params.get("error") === "access_denied" || params.has("error_code")) return "forgot";
    return params.has("admin-reset") ? "reset" : "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState(adminRecoveryEmail);
  const [resetToken, setResetToken] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("admin-reset") || "" : "",
  );
  const [resetOtp, setResetOtp] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("error") === "access_denied" || params.has("error_code")
      ? "This reset link has expired or was already used. Request a new reset email."
      : "";
  });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = window.setInterval(() => setResetCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resetCooldown]);
  useEffect(() => {
    if (staticPagesMode) {
      setAuthenticated(hasStaticAdminSession());
      setChecked(true);
      return;
    }
    void fetch("/api/admin-auth", { cache: "no-store" })
      .then(async (response) => {
        const result = await readAdminAuthResponse(response);
        if (!response.ok) {
          setError(adminApiUnavailableMessage(response.status));
          return;
        }
        setAuthenticated(Boolean(result.authenticated));
      })
      .catch(() => setError("Could not connect to admin login. Check that the local server is running."))
      .finally(() => setChecked(true));
  }, [staticPagesMode]);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    if (staticPagesMode) {
      const isStaticCredential =
        email.trim().toLowerCase() === staticAdminEmail.trim().toLowerCase() &&
        password === staticAdminPassword &&
        Boolean(staticAdminEmail && staticAdminPassword);
      if (isStaticCredential) {
        window.localStorage.setItem(staticAdminSessionKey, "true");
        setAuthenticated(true);
        setPassword("");
        setLoading(false);
        return;
      }
      if (supabase) {
        const { error: supabaseError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!supabaseError) {
          window.localStorage.setItem(staticAdminSessionKey, "true");
          setAuthenticated(true);
          setPassword("");
          setLoading(false);
          return;
        }
      }
      setError("Invalid admin email or password.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/admin-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await readAdminAuthResponse(response);
      if (!response.ok) { setError(result.error || adminApiUnavailableMessage(response.status)); return; }
      setAuthenticated(Boolean(result.authenticated));
      setPassword("");
    } catch { setError("Could not connect to admin login. Check that the local server is running."); }
    finally { setLoading(false); }
  };

  const openAuthView = (view: "login" | "forgot" | "reset") => {
    setAuthView(view);
    setError("");
    setResetMessage("");
  };

  const requestPasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetCooldown > 0) {
      setError("Please wait before requesting another reset email. Use the latest email already in your inbox.");
      return;
    }
    setLoading(true);
    setError("");
    setResetMessage("");
    if (resetEmail.trim().toLowerCase() !== adminRecoveryEmail) {
      setError(`Password reset is only available for ${adminRecoveryEmail}.`);
      setLoading(false);
      return;
    }
    try {
      if (!supabase) {
        setError("Supabase email recovery is not configured.");
        return;
      }
      const redirectTo = `${window.location.origin}/admin?admin-reset=1`;
      const { error: supabaseError } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), { redirectTo });
      if (supabaseError) {
        if (/rate limit|too many|email rate/i.test(supabaseError.message)) {
          setError("Supabase has temporarily limited reset emails. Use the latest email already in your inbox and try again later.");
          setResetCooldown(60);
        } else {
          setError(supabaseError.message || "Supabase could not send the reset email.");
        }
        return;
      }
      setResetMessage("Password reset email sent. Check fanzzy@vestanoretail.com inbox and spam folder.");
      setResetCooldown(60);
    } catch {
      setError("Could not connect to Supabase email recovery.");
    } finally {
      setLoading(false);
    }
  };

  const submitPasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResetMessage("");
    try {
      if (supabase) {
        let { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          const recoveryCode = new URLSearchParams(window.location.search).get("code");
          if (recoveryCode) {
            const exchanged = await supabase.auth.exchangeCodeForSession(recoveryCode);
            sessionData = exchanged.data.session ? { session: exchanged.data.session } : { session: null };
          }
        }
        if (sessionData.session) {
          const { error: supabaseError } = await supabase.auth.updateUser({ password: resetPassword });
          if (supabaseError) {
            setError(supabaseError.message || "Supabase could not update the password.");
            return;
          }
          await supabase.auth.signOut();
          setResetPassword("");
          setPassword("");
          setResetMessage("Password updated. You can sign in now.");
          setAuthView("login");
          window.history.replaceState({}, "", "/admin");
          return;
        }

        // A Supabase recovery URL must have an active recovery session. Never
        // fall through to the legacy local reset endpoint for a stale link.
        setAuthView("forgot");
        setError("This reset link has expired or was already used. Request a new reset email.");
        return;
      }
      const response = await fetch("/api/admin-auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: resetToken, otp: resetOtp, password: resetPassword }),
      });
      const result = await readAdminAuthResponse(response);
      if (!response.ok) {
        setError(result.error || "Could not reset the password.");
        return;
      }
      setResetPassword("");
      setPassword("");
      setResetMessage(result.message || "Password updated. You can sign in now.");
      setAuthView("login");
      window.history.replaceState({}, "", "/admin");
    } catch {
      setError("Could not connect to the password reset service. Check that the local server is running.");
    } finally {
      setLoading(false);
    }
  };

  if (!checked) return <div className="admin-auth-loading">Loading admin workspace…</div>;
  if (authenticated) return <AdminDashboard />;
  return <main className="admin-auth-page"><section className="admin-auth-card">
    <p className="eyebrow">FANZZY CONTROL ROOM</p>
    {authView === "login" && <>
      <h1>Admin sign in</h1>
      <p>Sign in to manage products, orders, stock, and store settings.</p>
      <form onSubmit={signIn}>
        <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        <button className="admin-forgot-link" type="button" onClick={() => openAuthView("forgot")}>Forgot password?</button>
        {error && <p className="admin-auth-error" role="alert">{error}</p>}
        {resetMessage && <p className="admin-auth-success" role="status">{resetMessage}</p>}
        <button className="module-primary" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
      </form>
    </>}
    {authView === "forgot" && <>
      <h1>Reset password</h1>
      <p>Enter your admin email and we’ll send a one-time password reset link.</p>
      <form onSubmit={requestPasswordReset}>
        <label>Admin email address<input type="email" value={resetEmail} readOnly autoComplete="email" required /></label>
        {error && <p className="admin-auth-error" role="alert">{error}</p>}
        {resetMessage && <p className="admin-auth-success" role="status">{resetMessage}</p>}
        <button className="module-primary" type="submit" disabled={loading || resetCooldown > 0}>{loading ? "Sending email…" : resetCooldown > 0 ? `Try again in ${resetCooldown}s` : "Send reset email"}</button>
        <button className="admin-auth-secondary" type="button" onClick={() => openAuthView("login")}>Back to sign in</button>
      </form>
    </>}
    {authView === "reset" && <>
      <h1>Choose a new password</h1>
      <p>Your email link has securely verified this password reset. Choose a new password below.</p>
      <form onSubmit={submitPasswordReset}>
        <label>New password<input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>
        {error && <p className="admin-auth-error" role="alert">{error}</p>}
        {resetMessage && <p className="admin-auth-success" role="status">{resetMessage}</p>}
        <button className="module-primary" type="submit" disabled={loading}>{loading ? "Updating password…" : "Update password"}</button>
        <button className="admin-auth-secondary" type="button" onClick={() => openAuthView("login")}>Back to sign in</button>
      </form>
    </>}
  </section></main>;
}

function AdminDashboard() {
  const [active, setActive] = useState("Overview");
  const [liveDate, setLiveDate] = useState(() => new Date());
  const [adminRoles, setAdminRoles] = useState<AdminRole[]>(defaultAdminRoles);
  const [activeRoleId, setActiveRoleId] = useState("vestano");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [productScannerRequest, setProductScannerRequest] = useState(0);
  const [reportView, setReportView] = useState<ReportView>("overview");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  // The Overview has no visible period selector, so default it to the complete
  // confirmed-order history instead of silently hiding orders from prior months.
  const [dateRange, setDateRange] = useState<DateRange>("all-time");
  const [dashboardFromDate, setDashboardFromDate] = useState(() => `${new Date().toISOString().slice(0, 8)}01`);
  const [dashboardToDate, setDashboardToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dashboardOrders, setDashboardOrders] = useState<OrderRecord[]>(adminOrders);
  const [dashboardProducts, setDashboardProducts] = useState<AdminProduct[]>(adminProducts);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  useEffect(() => {
    const timer = window.setInterval(() => setLiveDate(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const categories = useMemo(
    () => [
      "All categories",
      ...Array.from(new Set(dashboardProducts.map((product) => product.category))),
    ],
    [dashboardProducts],
  );
  const shownProducts = useMemo(
    () =>
      dashboardProducts.filter((product) => {
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
    [categoryFilter, dashboardProducts, productFilter, query],
  );
  const activeRole = adminRoles.find((role) => role.id === activeRoleId) ?? defaultAdminRoles[0];
  const canAccess = (section: string) => activeRole.permissions.includes(section as AdminPermission);
  const visibleMenu = menu.filter((item) => canAccess(item.label));

  useEffect(() => {
    let active = true;
    const syncDashboardProducts = async () => {
      const remote = await fetchCatalogProducts();
      if (!active) return;
      if (!remote.error && remote.data !== null) {
        setDashboardProducts(remote.data.filter((product) => !isDemoProduct(product)).map((product) => ({
          name: product.name,
          sku: product.sku,
          category: product.category,
          stock: product.stock,
          price: formatAdminCurrency(product.price),
          cost: formatAdminCurrency(product.cost ?? 0),
          status: product.status,
          image: product.image || adminPlaceholderImage,
          hoverImage: product.hoverImage || product.image || adminPlaceholderImage,
           compareAt: product.compareAt,
         })));
        return;
      }
      try {
        const stored = window.localStorage.getItem("fanzzy-products");
        const parsed = stored ? JSON.parse(stored) as Array<Partial<AdminProduct> & { price?: number | string; cost?: number | string }> : [];
        if (!Array.isArray(parsed)) return;
        setDashboardProducts(parsed.filter((product) => product.name && product.sku && !isDemoProduct(product)).map((product) => ({
          name: String(product.name),
          sku: String(product.sku),
          category: String(product.category || "Uncategorised"),
          stock: Number(product.stock) || 0,
          price: typeof product.price === "number" ? formatAdminCurrency(product.price) : String(product.price || "₹0"),
          cost: typeof product.cost === "number" ? formatAdminCurrency(product.cost) : String(product.cost || "₹0"),
          status: product.status || "Draft",
          image: String(product.image || adminPlaceholderImage),
          hoverImage: String(product.hoverImage || product.image || adminPlaceholderImage),
        })));
      } catch {
        setDashboardProducts([]);
      }
    };
    void syncDashboardProducts();
    const refreshDashboardProducts = () => { void syncDashboardProducts(); };
    window.addEventListener("storage", refreshDashboardProducts);
    window.addEventListener("fanzzy-products-updated", refreshDashboardProducts);
    return () => {
      active = false;
      window.removeEventListener("storage", refreshDashboardProducts);
      window.removeEventListener("fanzzy-products-updated", refreshDashboardProducts);
    };
  }, []);

  useEffect(() => {
    const syncDashboardOrders = async () => {
      const remote = await fetchStoreOrders<OrderRecord>();
      const merged = new Map<string, OrderRecord>();
      remote.data?.forEach((order) => { if (order?.id && !isDemoOrder(order)) merged.set(order.id, order); });
      try {
        const stored = window.localStorage.getItem("fanzzy-orders");
        const parsed = stored ? JSON.parse(stored) as OrderRecord[] : [];
        if (Array.isArray(parsed)) parsed.forEach((order) => {
          if (order?.id && !isDemoOrder(order) && !merged.has(order.id)) merged.set(order.id, order);
        });
      } catch {
        window.localStorage.removeItem("fanzzy-orders");
      }
      setDashboardOrders(Array.from(merged.values()).filter((order) => order?.date && order?.total && !isDemoOrder(order) && hasConfirmedPayment(order)));
    };
    void syncDashboardOrders();
    const dashboardOrderTimer = window.setInterval(() => { void syncDashboardOrders(); }, 60_000);
    const unsubscribeFromDashboardOrders = subscribeToStoreSetting("orders", syncDashboardOrders);
    window.addEventListener("storage", syncDashboardOrders);
    window.addEventListener("fanzzy-orders-updated", syncDashboardOrders);
    return () => {
      window.clearInterval(dashboardOrderTimer);
      unsubscribeFromDashboardOrders();
      window.removeEventListener("storage", syncDashboardOrders);
      window.removeEventListener("fanzzy-orders-updated", syncDashboardOrders);
    };
  }, []);

  const dashboardDelhiveryOrderKey = useMemo(
    () => dashboardOrders.filter((order) => order.delhiveryAwb && order.status !== "Delivered" && order.status !== "Cancelled").map((order) => `${order.id}::${order.delhiveryAwb}`).sort().join("|"),
    [dashboardOrders],
  );

  useEffect(() => {
    if (!dashboardDelhiveryOrderKey) return;
    const orderWaybills = dashboardDelhiveryOrderKey.split("|").map((value) => {
      const [id, waybill] = value.split("::");
      return { id, waybill };
    });
    const refreshDashboardTracking = async () => {
      await Promise.all(orderWaybills.map(({ id, waybill }) => fetch("/api/delhivery/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: id, waybill }),
        cache: "no-store",
      }).catch(() => undefined)));
    };
    void refreshDashboardTracking();
    const trackingTimer = window.setInterval(() => { void refreshDashboardTracking(); }, 60_000);
    return () => window.clearInterval(trackingTimer);
  }, [dashboardDelhiveryOrderKey]);

  useEffect(() => {
    const syncRoles = () => {
      setAdminRoles(defaultAdminRoles);
      setActiveRoleId("vestano");
      window.localStorage.setItem("fanzzy-admin-roles", JSON.stringify(defaultAdminRoles));
      window.localStorage.setItem("fanzzy-active-admin-role", "vestano");
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

  const customDashboardOrders = dashboardOrders.filter((order) => {
    if (!dashboardFromDate && !dashboardToDate) return true;
    if (dashboardFromDate && order.date < dashboardFromDate) return false;
    if (dashboardToDate && order.date > dashboardToDate) return false;
    return true;
  });
  const currentDate = new Date().toISOString().slice(0, 10);
  const monthStart = `${currentDate.slice(0, 8)}01`;
  const previousMonth = new Date(`${monthStart}T00:00:00`);
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousMonthStart = previousMonth.toISOString().slice(0, 8) + "01";
  const previousMonthEnd = `${monthStart}`;
  const dashboardPeriodOrders = dateRange === "custom"
    ? customDashboardOrders
    : dashboardOrders.filter((order) => dateRange === "all-time"
      || (dateRange === "today" && order.date === currentDate)
      || (dateRange === "this-month" && order.date >= monthStart && order.date <= currentDate)
      || (dateRange === "last-month" && order.date >= previousMonthStart && order.date < previousMonthEnd));
  const isDeliveredOrder = (order: OrderRecord) => order.status === "Delivered" || order.paymentStatus === "cod_collected" || /delivered/i.test(`${order.delhiveryLiveStatus || ""} ${order.delhiveryLiveStatusType || ""}`);
  const revenueOrders = dashboardPeriodOrders.filter((order) => order.paymentMethod !== "cod" || isDeliveredOrder(order));
  const pendingCodOrders = dashboardPeriodOrders.filter((order) => order.paymentMethod === "cod" && order.status !== "Cancelled" && !isDeliveredOrder(order));
  const periodRevenue = revenueOrders.reduce((total, order) => total + (Number(order.total.replace(/[^0-9.]/g, "")) || 0), 0);
  const pendingCodAmount = pendingCodOrders.reduce((total, order) => total + (Number(order.total.replace(/[^0-9.]/g, "")) || 0), 0);
  const periodCustomers = new Set(dashboardPeriodOrders.map((order) => order.phone || order.customerName || order.id)).size;
  const liveMetrics = {
    revenue: formatAdminCurrency(periodRevenue),
    codPending: formatAdminCurrency(pendingCodAmount),
    orders: String(dashboardPeriodOrders.length),
    average: formatAdminCurrency(revenueOrders.length ? periodRevenue / revenueOrders.length : 0),
    customers: String(periodCustomers),
    growth: ["—", "—", "—", "—"],
  };
  const displayedMetrics = liveMetrics;
  const statusCount = (statuses: OrderStatus[]) => String(dashboardPeriodOrders.filter((order) => statuses.includes(order.status)).length);
  const metricNote = dateRange === "this-month"
    ? "vs. last month"
    : dateRange === "all-time"
      ? "All confirmed orders"
      : dateRange === "today"
        ? "Today's confirmed orders"
      : dateRange === "custom"
        ? "Selected dates"
        : "Selected period";
  const dateLabels: Record<DateRange, string> = {
    today: "Today",
    "this-month": "This month",
    "last-month": "Last month",
    "all-time": "All time",
    custom: dashboardFromDate || dashboardToDate ? `${dashboardFromDate || "Start"} → ${dashboardToDate || "End"}` : "Custom range",
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
  const logOut = async () => {
    try {
      if (isGitHubPagesHost()) {
        window.localStorage.removeItem(staticAdminSessionKey);
      } else {
        await fetch("/api/admin-auth", { method: "DELETE", cache: "no-store" });
      }
    } finally {
      window.location.assign(`${siteBasePath}/admin`);
    }
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
          <span className="admin-access-badge">FULL ACCESS</span>
        </div>
        <p className="admin-label">Workspace</p>
        <nav className="admin-nav">
          {visibleMenu.map((item) => item.label === "Reports" ? (
            <div className="admin-nav-group" key={item.label}>
              <button
                className={active === item.label ? "active" : ""}
                onClick={() => { setActive("Reports"); setReportsOpen((current) => !current); }}
                aria-expanded={reportsOpen}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                <span className="nav-chevron">{reportsOpen ? "−" : "+"}</span>
              </button>
              {reportsOpen && <div className="admin-subnav">
                {([
                  ["overview", "All reports"],
                  ["sales", "Sales report"],
                  ["category", "Category report"],
                  ["item", "Item report"],
                  ["top-selling", "Top-selling item report"],
                  ["inventory", "Inventory / aged report"],
                  ["orders", "Order status report"],
                  ["damaged", "Damaged items report"],
                ] as Array<[ReportView, string]>).map(([view, label]) => <button key={view} className={active === "Reports" && reportView === view ? "active" : ""} onClick={() => { setActive("Reports"); setReportView(view); setReportsOpen(true); }}>{label}</button>)}
              </div>}
            </div>
          ) : (
            <button
              key={item.label}
              className={active === item.label ? "active" : ""}
              onClick={() => {
                if (item.label === "Product Image Scanner") {
                  setActive(item.label);
                  setProductScannerRequest((current) => current + 1);
                  return;
                }
                setActive(item.label);
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {(item.label === "Orders" ? dashboardOrders.length : item.label === "Products" ? dashboardProducts.length : item.count) !== undefined && <b>{item.label === "Orders" ? dashboardOrders.length : item.label === "Products" ? dashboardProducts.length : item.count}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className={active === "Settings" ? "active" : ""} onClick={() => canAccess("Settings") ? setActive("Settings") : notify(`${activeRole.title} cannot access Settings`)}>
            <span className="nav-icon">⚙</span>Settings
          </button>
          <button onClick={() => void logOut()}>
            <span className="nav-icon">↪</span>Log out
          </button>
          <a href={`${siteBasePath}/`}>
            <span className="nav-icon">↩</span>Storefront
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
            <button className="admin-logout-button" onClick={() => void logOut()}>
              Log out
            </button>
            <div className="mini-avatar">VE</div>
          </div>
        </header>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">{liveDate.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</p>
            <h1>
              Good morning, Vestano <span>✦</span>
            </h1>
            <p className="subcopy">
              Here’s what’s happening across Fanzzy today.
            </p>
          </div>
          {active === "Overview" && (
            <div className="dashboard-date-picker">
              <label className="date-control">
                Date filter
                <select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}>
                  <option value="all-time">All time</option>
                  <option value="today">Today</option>
                  <option value="this-month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="custom">Custom dates</option>
                </select>
              </label>
              {dateRange === "custom" && (
                <div className="dashboard-date-fields">
                  <label>
                    From
                    <input type="date" value={dashboardFromDate} onChange={(event) => setDashboardFromDate(event.target.value)} />
                  </label>
                  <label>
                    To
                    <input type="date" value={dashboardToDate} onChange={(event) => setDashboardToDate(event.target.value)} />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
        {active !== "Overview" && (
          <ModuleWorkspace module={active} onNotify={notify} reportView={reportView} productScannerRequest={productScannerRequest} />
        )}
        <div className="stats-grid">
          <Stat
            label="Revenue"
            value={displayedMetrics.revenue}
            change={displayedMetrics.growth[0]}
            note={metricNote}
          />
          <Stat
            label="COD Amount Pending"
            value={displayedMetrics.codPending}
            change="—"
            note={`${pendingCodOrders.length} awaiting delivery`}
          />
          <Stat
            label="Orders"
            value={displayedMetrics.orders}
            change={displayedMetrics.growth[1]}
            note={metricNote}
          />
          <Stat
            label="Average order"
            value={displayedMetrics.average}
            change={displayedMetrics.growth[2]}
            note={metricNote}
          />
          <Stat
            label="New customers"
            value={displayedMetrics.customers}
            change={displayedMetrics.growth[3]}
            note={metricNote}
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
              {displayedMetrics.revenue} <span>{dateRange === "custom" ? "Selected dates" : `↑ ${displayedMetrics.growth[0].slice(1)}`}</span>
            </div>
            <div className="sales-chart">
              <div className="chart-y">
                <span>₹0</span>
                <span>₹0</span>
                <span>₹0</span>
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
                  {dashboardPeriodOrders.length > 0 && <path d="M0,152 L640,152" fill="none" stroke="#4b1c2b" strokeWidth="3" />}
                </svg>
                <div className="chart-x">
                  <span>{dashboardPeriodOrders.length ? dateLabels[dateRange] : "No sales data yet"}</span>
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
                <strong>{displayedMetrics.orders}</strong>
                <span>Total orders</span>
              </div>
            </div>
            <div className="status-list">
              <Status
                color="wine"
                label="Delivered"
                value={
                    statusCount(["Delivered"])
                }
              />
              <Status
                color="gold"
                label="Processing"
                value={
                    statusCount(["Processing", "Packed"])
                }
              />
              <Status
                color="peach"
                label="Shipped"
                value={
                    statusCount(["Shipped"])
                }
              />
              <Status
                color="lavender"
                label="Pending"
                value={
                    statusCount(["Processing"])
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
                    All products <b>{shownProducts.length}</b>
                  </button>
                  <button
                    className={productFilter === "low-stock" ? "active" : ""}
                    onClick={() => setProductFilter("low-stock")}
                  >
                    Low stock <b>{dashboardProducts.filter((product) => product.stock < 10 || product.status === "Low stock").length}</b>
                  </button>
                  <button
                    className={productFilter === "drafts" ? "active" : ""}
                    onClick={() => setProductFilter("drafts")}
                  >
                    Drafts <b>{dashboardProducts.filter((product) => product.status === "Draft").length}</b>
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
              <span className="task-count">0</span>
            </div>
            <p className="empty-filter">No pending tasks.</p>
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
  module = false,
}: {
  onNotify: (message: string) => void;
  module?: boolean;
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
    <section className={`panel announcement-panel${module ? " announcement-module" : ""}`}>
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

function SuppliersWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const remote = await fetchStoreSetting("suppliers");
      const stored = remote.value || window.localStorage.getItem(localSuppliersKey);
      const parsedSuppliers = parseSupplierRecords(stored);
      const ensured = ensurePreferredSupplier(parsedSuppliers);
      const next = ensured.suppliers;
      if (!active) return;
      setSuppliers(next);
      setDefaultSupplierId(next.find((supplier) => supplier.isDefault)?.id || null);
      if (remote.value || ensured.changed) {
        if (ensured.changed) await saveStoreSetting("suppliers", JSON.stringify(next));
        persistSuppliers(next);
      }
    };
    const sync = () => {
      const next = parseSupplierRecords(window.localStorage.getItem(localSuppliersKey));
      setSuppliers(next);
      setDefaultSupplierId(next.find((supplier) => supplier.isDefault)?.id || null);
    };
    void load();
    window.addEventListener("fanzzy-suppliers-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-suppliers-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const resetForm = () => {
    setSupplierName("");
    setEditingId(null);
  };
  const save = async () => {
    const name = supplierName.trim();
    if (!name) return onNotify("Enter a supplier bill name");
    if (suppliers.some((supplier) => supplier.id !== editingId && supplier.name.toLowerCase() === name.toLowerCase())) {
      return onNotify("That supplier already exists");
    }
    const next = editingId
      ? suppliers.map((supplier) => supplier.id === editingId ? { ...supplier, name } : supplier)
      : [...suppliers, { id: `supplier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, createdAt: new Date().toISOString(), isDefault: false }];
    setSaving(true);
    const remoteError = await saveStoreSetting("suppliers", JSON.stringify(next));
    persistSuppliers(next);
    setSuppliers(next);
    setDefaultSupplierId(next.find((supplier) => supplier.isDefault)?.id || null);
    resetForm();
    setSaving(false);
    onNotify(remoteError ? "Supplier saved locally; shared settings need attention" : editingId ? "Supplier updated" : "Supplier created");
  };
  const remove = async (supplier: SupplierRecord) => {
    if (!window.confirm(`Delete supplier bill “${supplier.name}”? Existing products will keep this saved name.`)) return;
    const next = suppliers.filter((item) => item.id !== supplier.id);
    const remoteError = await saveStoreSetting("suppliers", JSON.stringify(next));
    persistSuppliers(next);
    setSuppliers(next);
    setDefaultSupplierId(next.find((item) => item.isDefault)?.id || null);
    if (editingId === supplier.id) resetForm();
    onNotify(remoteError ? "Supplier removed locally; shared settings need attention" : "Supplier removed");
  };
  const setDefault = async (supplier: SupplierRecord) => {
    const nextDefaultId = defaultSupplierId === supplier.id ? null : supplier.id;
    const next = suppliers.map((item) => ({ ...item, isDefault: item.id === nextDefaultId }));
    setSaving(true);
    const remoteError = await saveStoreSetting("suppliers", JSON.stringify(next));
    persistSuppliers(next);
    setSuppliers(next);
    setDefaultSupplierId(nextDefaultId);
    setSaving(false);
    onNotify(remoteError ? "Default saved locally; shared settings need attention" : nextDefaultId ? `${supplier.name} is now the default supplier` : "Default supplier cleared");
  };
  return (
    <section className="panel module-workspace suppliers-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">PURCHASE SETUP</p>
          <h2>Supplier bills</h2>
          <p>Create the supplier bill names that can be selected while entering products.</p>
        </div>
        <div className="module-summary supplier-count-summary"><span><i className="status-light" />Shared supplier list</span><span>{defaultSupplierId ? `Default: ${suppliers.find((supplier) => supplier.id === defaultSupplierId)?.name || "—"}` : "No default selected"}</span></div>
      </div>
      <div className="supplier-form-card">
        <div><p className="eyebrow">{editingId ? "EDIT SUPPLIER" : "NEW SUPPLIER"}</p><h3>{editingId ? "Update supplier bill" : "Create supplier bill"}</h3><p>Use the name exactly as it appears on the supplier invoice.</p></div>
        <div className="supplier-form-row">
          <label>Supplier bill name<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="e.g. ABC Jewellery Traders" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} /></label>
          <div className="module-actions"><button className="module-primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create supplier"}</button>{editingId && <button className="module-secondary" type="button" onClick={resetForm}>Cancel</button>}</div>
        </div>
      </div>
      <div className="supplier-list">
        {suppliers.map((supplier, index) => <article className="supplier-row" key={supplier.id}><span className="module-row-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{supplier.name}</strong><small>Available in the product entry supplier dropdown</small>{supplier.isDefault && <em>Default for new products</em>}</div><div className="module-actions"><button className={`supplier-default-toggle${supplier.isDefault ? " is-default" : ""}`} type="button" onClick={() => void setDefault(supplier)} disabled={saving}>{supplier.isDefault ? "Default supplier" : "Make default"}</button><button className="module-secondary" type="button" onClick={() => { setEditingId(supplier.id); setSupplierName(supplier.name); }}>Edit</button><button className="module-secondary delete-action" type="button" onClick={() => void remove(supplier)}>Delete</button></div></article>)}
        {!suppliers.length && <div className="supplier-empty"><strong>No supplier bills yet</strong><span>Create a supplier bill name here, then select it when adding a product.</span></div>}
      </div>
    </section>
  );
}

type SupplierBillSummary = {
  name: string;
  entries: number;
  units: number;
  total: number;
  products: Array<{ name: string; sku: string; createdAt?: string }>;
  isUnassigned?: boolean;
};
const existingMarginFloorMigrationKey = "fanzzy-existing-margin-floor-applied";
const getSupplierBillUnits = (product: {
  stock: number;
  variants?: Array<{ stock?: number }>;
  sizeStock?: Record<string, number>;
}) => {
  const variantStocks = (product.variants || [])
    .map((variant) => Number(variant.stock))
    .filter((stock) => Number.isFinite(stock));
  if (variantStocks.length) return variantStocks.reduce((total, stock) => total + Math.max(0, Math.floor(stock)), 0);

  const sizeStocks = Object.values(product.sizeStock || {})
    .map((stock) => Number(stock))
    .filter((stock) => Number.isFinite(stock));
  if (sizeStocks.length) return sizeStocks.reduce((total, stock) => total + Math.max(0, Math.floor(stock)), 0);

  return Math.max(0, Math.floor(Number(product.stock) || 0));
};
function SupplierBillsWorkspace() {
  const [summaries, setSummaries] = useState<SupplierBillSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const [catalogRemote, supplierNamesRemote, suppliersRemote, variantsRemote, variantTypeRemote, sizesRemote, sizeStockRemote] = await Promise.all([
        fetchCatalogProducts(),
        fetchStoreSetting("productSupplierNames"),
        fetchStoreSetting("suppliers"),
        fetchStoreSetting("productVariants"),
        fetchStoreSetting("productVariantType"),
        fetchStoreSetting("productSizes"),
        fetchStoreSetting("productSizeStock"),
      ]);
      const supplierNames = (() => {
        try {
          const parsed = JSON.parse(supplierNamesRemote.value || "{}") as Record<string, unknown>;
          return parsed && typeof parsed === "object"
            ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
            : {};
        } catch {
          return {};
        }
      })();
      let variantsMap: Record<string, ProductVariant[]> = {};
      let variantTypeMap: Record<string, ProductVariantType> = {};
      let sizesMap: Record<string, string[]> = {};
      let sizeStockMap: Record<string, Record<string, number>> = {};
      try {
        const parsed = JSON.parse(variantsRemote.value || "{}") as Record<string, ProductVariant[]>;
        if (parsed && typeof parsed === "object") variantsMap = parsed;
      } catch {
        variantsMap = {};
      }
      try {
        const parsed = JSON.parse(variantTypeRemote.value || "{}") as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          variantTypeMap = Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, ProductVariantType] => entry[1] === "normal" || entry[1] === "size"),
          );
        }
      } catch {
        variantTypeMap = {};
      }
      try {
        const parsed = JSON.parse(sizesRemote.value || "{}") as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          sizesMap = Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((size) => typeof size === "string")),
          );
        }
      } catch {
        sizesMap = {};
      }
      try {
        const parsed = JSON.parse(sizeStockRemote.value || "{}") as Record<string, Record<string, number>>;
        if (parsed && typeof parsed === "object") sizeStockMap = parsed;
      } catch {
        sizeStockMap = {};
      }
      let products: Array<{
        name: string;
        sku: string;
        cost: string | number;
        price: string | number;
        stock: number;
        supplierName?: string;
        createdAt?: string;
        variants?: ProductVariant[];
        sizes?: string[];
        sizeStock?: Record<string, number>;
        variantType?: ProductVariantType;
      }> = [];
      if (!catalogRemote.error && catalogRemote.data !== null) {
        products = catalogRemote.data.map((product) => {
          const variants = variantsMap[product.sku]?.length ? variantsMap[product.sku] : product.variants || [];
          const savedSizeStock = sizeStockMap[product.sku] || {};
          return {
            name: product.name,
            sku: product.sku,
            createdAt: product.createdAt,
            cost: product.cost ?? 0,
            price: product.price,
            stock: Number(product.stock) || 0,
            supplierName: (product as typeof product & { supplierName?: string }).supplierName,
            variants,
            sizes: sizesMap[product.sku] || product.sizes || [],
            sizeStock: Object.keys(savedSizeStock).length
              ? savedSizeStock
              : Object.fromEntries(variants.filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!])),
            variantType: variantTypeMap[product.sku] || product.variantType,
          };
        });
      } else if (typeof window !== "undefined") {
        try {
          const parsed = JSON.parse(window.localStorage.getItem("fanzzy-products") || "[]") as Array<Partial<AdminProduct> & { id?: string; cost?: string | number }>;
          products = parsed.filter((product) => product.sku || product.id).map((product, index) => ({
            name: String(product.name || "Unnamed product"),
            sku: product.sku || product.id || `local-${index}`,
            createdAt: product.createdAt,
            cost: product.cost ?? 0,
            price: product.price ?? 0,
            stock: Number(product.stock) || 0,
            supplierName: product.supplierName,
            variants: product.variants,
            sizes: product.sizes,
            sizeStock: product.sizeStock,
            variantType: product.variantType,
          }));
        } catch {
          products = [];
        }
      }
      const missingSupplierProducts = products.filter((product) => !(product.supplierName || supplierNames[product.sku] || "").trim());
      if (missingSupplierProducts.length) {
        const assignedSupplierNames = Object.fromEntries(missingSupplierProducts.map((product) => [product.sku, preferredDefaultSupplierName]));
        await saveStoreSetting("productSupplierNames", JSON.stringify({ ...supplierNames, ...assignedSupplierNames }));
        if (typeof window !== "undefined") {
          try {
            const storedCatalog = JSON.parse(window.localStorage.getItem("fanzzy-products") || "[]") as Array<Record<string, unknown>>;
            if (Array.isArray(storedCatalog)) {
              window.localStorage.setItem("fanzzy-products", JSON.stringify(storedCatalog.map((product) => {
                const sku = String(product.sku || product.id || "");
                return assignedSupplierNames[sku] ? { ...product, supplierName: preferredDefaultSupplierName } : product;
              })));
              window.dispatchEvent(new Event("fanzzy-products-updated"));
            }
          } catch {
            // The supplier setting remains the source of truth when local storage is unavailable.
          }
        }
        products = products.map((product) => assignedSupplierNames[product.sku] ? { ...product, supplierName: preferredDefaultSupplierName } : product);
        Object.assign(supplierNames, assignedSupplierNames);
      }
      const shouldApplyExistingMarginFloor = typeof window !== "undefined" && window.localStorage.getItem(existingMarginFloorMigrationKey) !== "true";
      const adjustedProducts = products.map((product) => ({
        ...product,
        price: shouldApplyExistingMarginFloor
          ? normalizeSellingPriceForMargin(product.cost, product.price)
          : normalizeWholeSellingPrice(product.price),
      }));
      const priceUpdates = new Map(
        adjustedProducts
          .filter((product, index) => parseMoney(String(product.price)) !== parseMoney(String(products[index]?.price)))
          .map((product) => [product.sku, product.price]),
      );
      if (shouldApplyExistingMarginFloor && priceUpdates.size && typeof window !== "undefined") {
        try {
          const storedCatalog = JSON.parse(window.localStorage.getItem("fanzzy-products") || "[]") as Array<Record<string, unknown>>;
          if (Array.isArray(storedCatalog)) {
            const updatedCatalog = storedCatalog.map((product) => {
              const sku = String(product.sku || product.id || "");
              return priceUpdates.has(sku) ? { ...product, price: priceUpdates.get(sku) } : product;
            });
            window.localStorage.setItem("fanzzy-products", JSON.stringify(updatedCatalog));
            window.dispatchEvent(new Event("fanzzy-products-updated"));
          }
        } catch {
          // The shared catalog update below remains available when local storage is unavailable.
        }
      }
      if (shouldApplyExistingMarginFloor && priceUpdates.size && catalogRemote.data) {
        await Promise.all(catalogRemote.data.filter((product) => priceUpdates.has(product.sku)).map((product) => saveCatalogProduct({ ...product, price: parseMoney(String(priceUpdates.get(product.sku))) })));
      }
      if (shouldApplyExistingMarginFloor && typeof window !== "undefined") window.localStorage.setItem(existingMarginFloorMigrationKey, "true");
      products = adjustedProducts;
      const storedSuppliers = suppliersRemote.value || (typeof window !== "undefined" ? window.localStorage.getItem(localSuppliersKey) : null);
      const suppliers = ensurePreferredSupplier(parseSupplierRecords(storedSuppliers)).suppliers;
      const summaryMap = new Map<string, SupplierBillSummary>();
      suppliers.forEach((supplier) => summaryMap.set(supplier.name.toLowerCase(), { name: supplier.name, entries: 0, units: 0, total: 0, products: [] }));
      let unassigned: SupplierBillSummary | null = null;
      products.forEach((product) => {
        const supplierName = (product.supplierName || supplierNames[product.sku] || "").trim();
        const key = supplierName.toLowerCase();
        const summary = key ? summaryMap.get(key) : undefined;
        const target = summary || (unassigned ||= { name: "Unassigned", entries: 0, units: 0, total: 0, products: [], isUnassigned: true });
        const units = getSupplierBillUnits(product);
        target.entries += 1;
        target.units += units;
        target.total += parseMoney(String(product.cost)) * units;
        target.products.push({ name: product.name, sku: product.sku, createdAt: product.createdAt });
      });
      const next = [...summaryMap.values()];
      if (unassigned) next.push(unassigned);
      if (active) {
        setSummaries(next);
        setLoading(false);
      }
    };
    void load();
    const refresh = () => void load();
    window.addEventListener("fanzzy-suppliers-updated", refresh);
    window.addEventListener("fanzzy-products-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-suppliers-updated", refresh);
      window.removeEventListener("fanzzy-products-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const totalEntries = summaries.reduce((sum, summary) => sum + summary.entries, 0);
  const totalUnits = summaries.reduce((sum, summary) => sum + summary.units, 0);
  const totalValue = summaries.reduce((sum, summary) => sum + summary.total, 0);

  return (
    <section className="panel module-workspace supplier-bills-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">PURCHASE CONTROL</p>
          <h2>Supplier bill summary</h2>
          <p>See how many product entries belong to each supplier bill and the total purchase value of current stock.</p>
        </div>
        <div className="module-summary supplier-bills-total"><span><i className="status-light" />{totalEntries} entries · {totalUnits} units</span><strong>{formatAdminCurrency(totalValue)}</strong></div>
      </div>
      <div className="supplier-bill-summary-list">
        <div className="supplier-bill-summary-heading"><span>SUPPLIER BILL</span><span>ENTRIES</span><span>UNITS</span><span>TOTAL PURCHASE VALUE</span></div>
        {loading ? <div className="supplier-bill-empty">Loading supplier bill totals…</div> : summaries.map((summary) => <article className={`supplier-bill-summary-row${summary.isUnassigned ? " is-unassigned" : ""}`} key={summary.name}><div><strong>{summary.name}</strong><small>{summary.isUnassigned ? "Assign this product to a supplier bill from Products" : "Current catalog allocation"}</small></div><b>{summary.entries}</b><b>{summary.units}</b><strong>{formatAdminCurrency(summary.total)}</strong></article>)}
        {!loading && !summaries.length && <div className="supplier-bill-empty">No supplier bills or products found yet.</div>}
        {!loading && summaries.filter((summary) => summary.isUnassigned).map((summary) => <div className="supplier-bill-unassigned-details" key={`${summary.name}-details`}><p className="eyebrow">UNASSIGNED PRODUCTS · SELECT A SUPPLIER BILL FROM PRODUCTS</p><div>{summary.products.map((product) => <span key={product.sku}><strong>{product.name}</strong><small>{product.sku} · Created {product.createdAt ? new Date(product.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Date unavailable"}</small></span>)}</div></div>)}
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
    rows: [],
  },
  Categories: {
    eyebrow: "CATALOG",
    title: "Categories",
    description:
      "Keep collections easy to browse with clear category structure.",
    primary: "Add category",
    secondary: "Reorder",
    rows: [],
  },
  Collections: {
    eyebrow: "MERCHANDISING",
    title: "Collections",
    description: "Shape the edits customers see across the Fanzzy storefront.",
    primary: "New collection",
    secondary: "Manage featured",
    rows: [],
  },
  Orders: {
    eyebrow: "OPERATIONS",
    title: "Orders",
    description:
      "Review new orders, update fulfilment, and keep customers informed.",
    primary: "View pending",
    secondary: "Export orders",
    rows: [],
  },
  Customers: {
    eyebrow: "RELATIONSHIPS",
    title: "Customers",
    description: "Understand your community and support every order with care.",
    primary: "Add customer",
    secondary: "Export list",
    rows: [],
  },
  Agents: {
    eyebrow: "PARTNER SALES",
    title: "Agent coupons",
    description: "Create referral coupons for agents and measure the customers and orders they bring in.",
    primary: "Add agent",
    secondary: "View performance",
    rows: [],
  },
  Marketing: {
    eyebrow: "GROWTH",
    title: "Marketing studio",
    description:
      "Manage campaigns, coupons, and the messages that bring customers back.",
    primary: "Create campaign",
    secondary: "New coupon",
    rows: [],
  },
  "Buy 1 Get X Free": {
    eyebrow: "PROMOTIONS",
    title: "Buy 1 Get X Free",
    description: "Create one-product offers with 1–4 free variants or sizes.",
    primary: "Create offer",
    secondary: "View report",
    rows: [],
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
      "Admin roles · 1 full access role",
    ],
  },
};

function ModuleWorkspace({
  module,
  onNotify,
  reportView = "overview",
  productScannerRequest = 0,
}: {
  module: string;
  onNotify: (message: string) => void;
  reportView?: ReportView;
  productScannerRequest?: number;
}) {
  if (module === "Product Image Scanner")
    return <ProductLibraryWorkspace onNotify={onNotify} productScannerRequest={productScannerRequest} scannerOnly />;
  if (module === "Products")
    return <ProductLibraryWorkspace onNotify={onNotify} />;
  if (module === "Reports") return <ReportsWorkspace onNotify={onNotify} view={reportView} />;
  if (module === "Announcement") return <AnnouncementPanel onNotify={onNotify} module />;
  if (module === "Categories") return <CategoryWorkspace onNotify={onNotify} />;
  if (module === "Orders") return <OrdersWorkspace onNotify={onNotify} />;
  if (module === "Refund requests") return <RefundRequestsWorkspace onNotify={onNotify} />;
  if (module === "Homepage") return <HomepageWorkspace onNotify={onNotify} />;
  if (module === "Delivery charge")
    return <DeliveryChargeWorkspace onNotify={onNotify} />;
  if (module === "Hub") return <HubWorkspace onNotify={onNotify} />;
  if (module === "Marketing") return <MarketingWorkspace onNotify={onNotify} />;
  if (module === "Buy 1 Get X Free") return <PromotionOffersWorkspace onNotify={onNotify} />;
  if (module === "Collections")
    return <CollectionsWorkspace onNotify={onNotify} />;
  if (module === "Customers") return <CustomersWorkspace onNotify={onNotify} />;
  if (module === "Agents") return <AgentsWorkspace onNotify={onNotify} />;
  if (module === "Settings") return <SettingsWorkspace onNotify={onNotify} />;
  if (module === "Vendors") return <AdminVendorsWorkspace onNotify={onNotify} />;
  if (module === "Suppliers") return <SuppliersWorkspace onNotify={onNotify} />;
  if (module === "Supplier Bills") return <SupplierBillsWorkspace />;
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

type VisualFingerprint = {
  color: number[];
  luminance: number[];
  edges: number[];
  hash: number[];
  aspect: number;
};
type ProductScannerMatch = {
  product: AdminProduct;
  variant?: ProductVariant;
  confidence: number;
};

const createVisualFingerprint = (source: string) => new Promise<VisualFingerprint>((resolve, reject) => {
  const image = new window.Image();
  image.crossOrigin = "anonymous";
  image.onerror = () => reject(new Error("Could not read product image"));
  image.onload = () => {
    const frameSize = 48;
    const canvas = document.createElement("canvas");
    canvas.width = frameSize;
    canvas.height = frameSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      reject(new Error("Visual search is not supported in this browser"));
      return;
    }
    const normalize = (values: number[]) => {
      const total = values.reduce((sum, value) => sum + value, 0);
      return total ? values.map((value) => value / total) : values;
    };
    const extractFrame = (cropRatio: number) => {
      const imageWidth = Math.max(1, image.naturalWidth);
      const imageHeight = Math.max(1, image.naturalHeight);
      const cropSize = Math.min(imageWidth, imageHeight) * cropRatio;
      const sourceX = (imageWidth - cropSize) / 2;
      const sourceY = (imageHeight - cropSize) / 2;
      context.fillStyle = "#f7f2ed";
      context.fillRect(0, 0, frameSize, frameSize);
      context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, frameSize, frameSize);
      const pixels = context.getImageData(0, 0, frameSize, frameSize).data;
      const color = new Array(20).fill(0);
      const luminanceHistogram = new Array(16).fill(0);
      const grayscale = new Array(frameSize * frameSize).fill(0);
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        const red = pixels[pixel] / 255;
        const green = pixels[pixel + 1] / 255;
        const blue = pixels[pixel + 2] / 255;
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
        let hue = 0;
        if (maximum !== minimum) {
          const delta = maximum - minimum;
          if (maximum === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
          else if (maximum === green) hue = ((blue - red) / delta + 2) / 6;
          else hue = ((red - green) / delta + 4) / 6;
        }
        const hueBin = Math.min(11, Math.floor(hue * 12));
        color[hueBin] += saturation;
        color[12 + Math.min(3, Math.floor(saturation * 4))] += 1;
        color[16 + Math.min(3, Math.floor(maximum * 4))] += 1;
        luminanceHistogram[Math.min(15, Math.floor(luminance * 16))] += 1;
        grayscale[pixel / 4] = luminance;
      }
      const edges = new Array(8).fill(0);
      for (let row = 0; row < frameSize - 1; row += 1) {
        for (let column = 0; column < frameSize - 1; column += 1) {
          const index = row * frameSize + column;
          const horizontal = grayscale[index + 1] - grayscale[index];
          const vertical = grayscale[index + frameSize] - grayscale[index];
          const magnitude = Math.sqrt(horizontal ** 2 + vertical ** 2);
          if (magnitude < 0.025) continue;
          let angle = Math.atan2(vertical, horizontal);
          if (angle < 0) angle += Math.PI;
          edges[Math.min(7, Math.floor((angle / Math.PI) * 8))] += magnitude;
        }
      }
      const hashSamples: number[] = [];
      for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 8; column += 1) {
          let total = 0;
          for (let y = 0; y < 6; y += 1) {
            for (let x = 0; x < 6; x += 1) total += grayscale[(row * 6 + y) * frameSize + column * 6 + x];
          }
          hashSamples.push(total / 36);
        }
      }
      const hashAverage = hashSamples.reduce((sum, value) => sum + value, 0) / hashSamples.length;
      return {
        color: normalize(color),
        luminance: normalize(luminanceHistogram),
        edges: normalize(edges),
        hash: hashSamples.map((value) => value >= hashAverage ? 1 : 0),
      };
    };
    const frames = [extractFrame(1), extractFrame(0.72)];
    const average = (key: "color" | "luminance" | "edges") => normalize(frames.reduce((combined, frame) => combined.map((value, index) => value + frame[key][index]), new Array(frames[0][key].length).fill(0)));
    resolve({
      color: average("color"),
      luminance: average("luminance"),
      edges: average("edges"),
      hash: frames.flatMap((frame) => frame.hash),
      aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
    });
  };
  image.src = source;
});

const compareVisualFingerprints = (left: VisualFingerprint, right: VisualFingerprint) => {
  const histogramSimilarity = (first: number[], second: number[]) => {
    const length = Math.min(first.length, second.length);
    if (!length) return 0;
    const distance = first.slice(0, length).reduce((sum, value, index) => sum + Math.abs(value - second[index]), 0);
    return Math.max(0, 1 - distance / 2);
  };
  const hashSimilarity = (first: number[], second: number[]) => {
    const length = Math.min(first.length, second.length);
    if (!length) return 0;
    const differences = first.slice(0, length).reduce((sum, value, index) => sum + (value === second[index] ? 0 : 1), 0);
    return 1 - differences / length;
  };
  const colorSimilarity = histogramSimilarity(left.color, right.color);
  const luminanceSimilarity = histogramSimilarity(left.luminance, right.luminance);
  const edgeSimilarity = histogramSimilarity(left.edges, right.edges);
  const hashScore = hashSimilarity(left.hash, right.hash);
  const aspectSimilarity = Math.max(0, 1 - Math.min(1, Math.abs(Math.log(Math.max(0.1, left.aspect) / Math.max(0.1, right.aspect)))));
  return Math.max(0, Math.min(100, Math.round((colorSimilarity * 0.24 + luminanceSimilarity * 0.12 + edgeSimilarity * 0.38 + hashScore * 0.21 + aspectSimilarity * 0.05) * 100)));
};

const readScannerPreview = async (file: File) => {
  try {
    return await makeLocalImage(file);
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
      reader.readAsDataURL(file);
    });
  }
};

function ProductImageScanner({
  products,
  promotionOffers,
  onClose,
  onView,
  onEdit,
  onUpdateStock,
  onAddNew,
}: {
  products: AdminProduct[];
  promotionOffers: PromotionOffer[];
  onClose: () => void;
  onView: (product: AdminProduct) => void;
  onEdit: (product: AdminProduct) => void;
  onUpdateStock: (product: AdminProduct) => void;
  onAddNew: (file: File, preview: string) => void;
}) {
  const [preview, setPreview] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<ProductScannerMatch[]>([]);
  const [status, setStatus] = useState<"idle" | "scanning" | "complete" | "error">("idle");
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const scanFile = async (file: File) => {
    setSourceFile(file);
    setMatches([]);
    setError("");
    setStatus("scanning");
    try {
      const imagePreview = await readScannerPreview(file);
      setPreview(imagePreview);
      if (!products.length) {
        setStatus("complete");
        setError("No catalog products are available to compare yet.");
        return;
      }
      const queryFingerprint = await createVisualFingerprint(imagePreview);
      const candidates = products.flatMap((product) => [
        product.image ? { product, variant: undefined, source: product.image } : null,
        ...(product.variants || []).filter((variant) => variant.image).map((variant) => ({ product, variant, source: variant.image })),
      ].filter((candidate): candidate is { product: AdminProduct; variant: ProductVariant | undefined; source: string } => Boolean(candidate)));
      const scored = await Promise.all(candidates.map(async (candidate) => {
        try {
          const fingerprint = await createVisualFingerprint(candidate.source);
          return { ...candidate, confidence: compareVisualFingerprints(queryFingerprint, fingerprint) };
        } catch {
          return null;
        }
      }));
      const bestByProduct = new Map<string, ProductScannerMatch>();
      scored.filter((candidate): candidate is { product: AdminProduct; variant: ProductVariant | undefined; source: string; confidence: number } => Boolean(candidate)).forEach((candidate) => {
        const current = bestByProduct.get(candidate.product.sku);
        if (!current || candidate.confidence > current.confidence) bestByProduct.set(candidate.product.sku, { product: candidate.product, variant: candidate.variant, confidence: candidate.confidence });
      });
      const rankedMatches = Array.from(bestByProduct.values()).sort((left, right) => right.confidence - left.confidence);
      const bestConfidence = rankedMatches[0]?.confidence || 0;
      setMatches(rankedMatches.filter((match) => match.confidence >= 68 && match.confidence >= bestConfidence - 14).slice(0, 4));
      setStatus("complete");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not scan this image");
      setStatus("error");
    }
  };
  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
  }, []);
  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };
  const startCamera = async () => {
    setError("");
    setStatus("idle");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Live camera is not supported in this browser. Please use a current mobile or desktop browser.");
      setStatus("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      window.requestAnimationFrame(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      });
    } catch {
      setError("Camera access was blocked. Allow camera permission and try again.");
      setStatus("error");
    }
  };
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setError("Camera is still starting. Please wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture the camera image. Please try again.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Could not capture the camera image. Please try again.");
        return;
      }
      const file = new File([blob], `fanzzy-scan-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopCamera();
      void scanFile(file);
    }, "image/jpeg", 0.92);
  };
  const statusLabel = (product: AdminProduct) => product.status === "Published" ? "Active" : "Inactive";
  const matchStock = (match: ProductScannerMatch) => match.variant?.stock === undefined ? `${match.product.stock} units` : `${match.variant.stock} units`;
  const matchVariant = (match: ProductScannerMatch) => match.variant ? [match.variant.name, match.variant.size ? `Size ${match.variant.size}` : ""].filter(Boolean).join(" · ") : "Main product image";
  const mrp = (product: AdminProduct) => product.compareAt && product.compareAt > parseMoney(product.price) ? formatAdminCurrency(product.compareAt) : product.price;
  const offerPrice = (product: AdminProduct) => {
    const productKeys = new Set([product.sku.toLowerCase(), product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")]);
    const offer = promotionOffers.find((candidate) => isPromotionLive(candidate) && (!candidate.eligiblePaid.length || candidate.eligiblePaid.some((selection) => productKeys.has(String(selection.productId || "").toLowerCase()))));
    if (!offer) return "—";
    return offer.type === "bundle" ? formatAdminCurrency(offer.fixedBundlePrice) : product.price;
  };

  return (
    <section className="product-image-scanner" aria-labelledby="product-image-scanner-title">
      <div className="scanner-heading">
        <div>
          <p className="eyebrow">AI VISUAL SEARCH</p>
          <h3 id="product-image-scanner-title">Product Image Scanner</h3>
          <p>Compare shape, colour, pattern, and visual appearance against the existing Fanzzy catalog. Barcode and QR data are not used.</p>
        </div>
        <button className="product-modal-close scanner-close" onClick={onClose} aria-label="Close product image scanner">×</button>
      </div>
      <div className="scanner-stepper"><span className="active">01 Scan image</span><i>→</i><span className={status !== "idle" ? "active" : ""}>02 AI search</span><i>→</i><span className={matches.length ? "active" : ""}>03 Match details</span></div>
      {!preview && !cameraActive && <div className="scanner-dropzone"><span>✦</span><strong>Open live camera to scan a product</strong><small>Use the rear camera and keep the jewellery centered in frame.</small><div className="scanner-actions"><button className="module-primary" onClick={() => void startCamera()}>Open live camera</button></div></div>}
      {cameraActive && <div className="scanner-camera"><video ref={videoRef} autoPlay muted playsInline aria-label="Live product camera preview" /><p className="scanner-camera-hint">Center the product in the frame, then capture the photo.</p><div className="scanner-camera-actions"><button className="module-primary" onClick={capturePhoto}>Capture photo &amp; search</button><button className="module-secondary" onClick={stopCamera}>Cancel camera</button></div></div>}
      {preview && <div className="scanner-query"><img src={preview} alt="Scanned product" /><div><p className="eyebrow">SCANNED IMAGE</p><strong>{status === "scanning" ? "Searching the product catalog…" : status === "error" ? "Scan could not be completed" : "Image ready"}</strong><small>{status === "scanning" ? `Comparing against ${products.length} product${products.length === 1 ? "" : "s"} images` : sourceFile?.name}</small><button className="module-secondary" onClick={() => { setPreview(""); setSourceFile(null); setMatches([]); setStatus("idle"); setError(""); }}>Scan another image</button></div></div>}
      {status === "scanning" && <div className="scanner-progress"><span className="status-light" /> AI visual search is comparing catalog images…</div>}
      {error && <p className="scanner-error">{error}</p>}
      {status === "complete" && matches.length > 0 && <div className="scanner-results"><div className="scanner-results-heading"><div><p className="eyebrow">MATCHING PRODUCTS</p><h4>{matches[0].confidence >= 82 ? `${matches[0].confidence}% Match — Same Product Found` : "Visually Similar Products Found"}</h4></div><span>{matches.length} result{matches.length === 1 ? "" : "s"}</span></div><div className="scanner-match-list">{matches.map((match) => <article className="scanner-match-card" key={match.product.sku}><div className="scanner-match-image"><img src={match.variant?.image || match.product.image} alt={match.product.name} /><strong>{match.confidence}%</strong></div><div className="scanner-match-copy"><div className="scanner-match-title"><div><h5>{match.product.name}</h5><small>{match.product.sku} · {match.product.category}</small></div><span className={statusLabel(match.product) === "Active" ? "scanner-status active" : "scanner-status inactive"}>{statusLabel(match.product)}</span></div><p className="scanner-variant">Variant: <strong>{matchVariant(match)}</strong></p><div className="scanner-detail-grid"><span><small>Cost price / unit rate</small><strong>{match.product.cost}</strong></span><span><small>Selling price</small><strong>{match.product.price}</strong></span><span><small>MRP</small><strong>{mrp(match.product)}</strong></span><span><small>Offer price</small><strong>{offerPrice(match.product)}</strong></span><span><small>Available stock</small><strong>{matchStock(match)}</strong></span><span><small>Product ID / SKU</small><strong>{match.product.sku}</strong></span></div><div className="scanner-match-actions"><button className="module-secondary" onClick={() => onView(match.product)}>View Product</button><button className="module-secondary" onClick={() => onEdit(match.product)}>Edit Product</button><button className="module-primary" onClick={() => onUpdateStock(match.product)}>Update Stock</button></div></div></article>)}</div></div>}
      {status === "complete" && matches.length === 0 && <div className="scanner-no-match"><span>❌</span><h4>No Matching Product Found in Fanzzy</h4><p>The image did not reach the visual-match threshold against the current catalog.</p>{sourceFile && <button className="module-primary" onClick={() => onAddNew(sourceFile, preview)}>+ Add as New Product</button>}</div>}
    </section>
  );
}

type ReportPeriod = "today" | "this-week" | "this-month" | "last-month" | "all-time" | "custom";
type ReportMovementFilter = "all" | "sales" | "slow" | "no-sales" | "out-of-stock";
type ProductReportRow = {
  product: AdminProduct;
  units: number;
  revenue: number;
  stockDetails: string;
};
type SalesProductReportRow = {
  invoiceNumber: string;
  orderId: string;
  customerName: string;
  date: string;
  productName: string;
  sku: string;
  units: number;
  unitRate: number;
  grossSales: number;
  taxableSales: number;
  cgst: number;
  sgst: number;
  grossProfit: number | null;
};

const parseReportMoney = (value: string | number) =>
  typeof value === "number"
    ? value
    : Number(String(value).replace(/[^0-9.]/g, "")) || 0;

const getReportInvoiceNumber = (order: Pick<OrderRecord, "id"> & { invoiceNumber?: string }) => order.invoiceNumber || order.id;

const getReportStockSummary = (product: Pick<AdminProduct, "stock" | "variantType" | "sizes" | "sizeStock" | "variants">) => {
  const formatStock = (value: unknown) => Number.isFinite(Number(value)) ? String(Math.max(0, Number(value))) : "0";
  const variants = product.variants || [];
  const hasVariantStock = variants.some((variant) => variant.stock !== undefined && Number.isFinite(Number(variant.stock)));
  if (variants.length && hasVariantStock) {
    const details = variants.map((variant, index) => {
      const label = product.variantType === "size"
        ? variant.size || variant.name || `Size ${index + 1}`
        : variant.name || `Option ${index + 1}`;
      return `${product.variantType === "size" ? `Size ${label}` : label}: ${formatStock(variant.stock)}`;
    });
    return { stock: variants.reduce((total, variant) => total + Math.max(0, Number(variant.stock) || 0), 0), details: details.join(" · ") };
  }
  const sizes = product.sizes || [];
  const sizeStock = product.sizeStock || {};
  if (product.variantType === "size" && sizes.length && Object.keys(sizeStock).length) {
    const details = sizes.map((size) => `Size ${size}: ${formatStock(sizeStock[size])}`);
    return { stock: sizes.reduce((total, size) => total + Math.max(0, Number(sizeStock[size]) || 0), 0), details: details.join(" · ") };
  }
  return { stock: Math.max(0, Number(product.stock) || 0), details: "Product stock" };
};

const reportNameKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
const reportDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const reportDateBounds = (period: ReportPeriod, latestDate: string, fromDate: string, toDate: string) => {
  const latest = new Date(`${latestDate}T00:00:00`);
  if (period === "today") return { from: latestDate, to: latestDate };
  if (period === "this-week") {
    const start = new Date(latest);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    return { from: reportDateKey(start), to: latestDate };
  }
  if (period === "this-month") return { from: `${latestDate.slice(0, 8)}01`, to: latestDate };
  if (period === "last-month") {
    const start = new Date(latest.getFullYear(), latest.getMonth() - 1, 1);
    const end = new Date(latest.getFullYear(), latest.getMonth(), 0);
    return { from: reportDateKey(start), to: reportDateKey(end) };
  }
  if (period === "custom") return { from: fromDate || "0000-01-01", to: toDate || "9999-12-31" };
  return { from: "0000-01-01", to: "9999-12-31" };
};

function ReportsWorkspace({
  onNotify,
  view,
}: {
  onNotify: (message: string) => void;
  view: ReportView;
}) {
  const [period, setPeriod] = useState<ReportPeriod>("all-time");
  const [fromDate, setFromDate] = useState(() => `${new Date().toISOString().slice(0, 8)}01`);
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orders, setOrders] = useState<OrderRecord[]>(adminOrders);
  const [products, setProducts] = useState<AdminProduct[]>(adminProducts);
  const [productDamages, setProductDamages] = useState<ProductDamageMap>({});
  const [itemMovementFilter, setItemMovementFilter] = useState<ReportMovementFilter>("all");

  useEffect(() => {
    let active = true;
    const syncOrders = async () => {
      const merged = new Map<string, OrderRecord>();
      const remote = await fetchStoreOrders<OrderRecord>();
      remote.data?.forEach((order) => {
        if (order?.id && !isDemoOrder(order)) merged.set(order.id, order);
      });
      try {
        const stored = window.localStorage.getItem("fanzzy-orders");
        const parsed = stored ? JSON.parse(stored) as OrderRecord[] : [];
        if (Array.isArray(parsed)) parsed.forEach((order) => {
          if (order?.id && !isDemoOrder(order) && !merged.has(order.id)) merged.set(order.id, order);
        });
      } catch {
        window.localStorage.removeItem("fanzzy-orders");
      }
      if (active) setOrders(Array.from(merged.values()).filter((order) => order?.date && order?.total && hasConfirmedPayment(order)));
    };
    const syncProducts = async () => {
      const [remote, pricingRemote, variantsRemote, variantTypeRemote, sizesRemote, sizeStockRemote] = await Promise.all([
        fetchCatalogProducts(),
        fetchStoreSetting("productPricing"),
        fetchStoreSetting("productVariants"),
        fetchStoreSetting("productVariantType"),
        fetchStoreSetting("productSizes"),
        fetchStoreSetting("productSizeStock"),
      ]);
      if (!active) return;
      let pricingMap: Record<string, { gstRate?: number; markup?: number }> = {};
      if (pricingRemote.value) {
        try {
          const parsed = JSON.parse(pricingRemote.value) as Record<string, { gstRate?: number; markup?: number }>;
          if (parsed && typeof parsed === "object") pricingMap = parsed;
        } catch {
          pricingMap = {};
        }
      }
      let variantsMap: Record<string, ProductVariant[]> = {};
      let variantTypeMap: Record<string, ProductVariantType> = {};
      let sizesMap: Record<string, string[]> = {};
      let sizeStockMap: Record<string, Record<string, number>> = {};
      if (variantsRemote.value) {
        try {
          const parsed = JSON.parse(variantsRemote.value) as Record<string, ProductVariant[]>;
          if (parsed && typeof parsed === "object") variantsMap = parsed;
        } catch {
          variantsMap = {};
        }
      }
      if (variantTypeRemote.value) {
        try {
          const parsed = JSON.parse(variantTypeRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            variantTypeMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, ProductVariantType] => entry[1] === "normal" || entry[1] === "size"),
            );
          }
        } catch {
          variantTypeMap = {};
        }
      }
      if (sizesRemote.value) {
        try {
          const parsed = JSON.parse(sizesRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            sizesMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((size) => typeof size === "string")),
            );
          }
        } catch {
          sizesMap = {};
        }
      }
      if (sizeStockRemote.value) {
        try {
          const parsed = JSON.parse(sizeStockRemote.value) as Record<string, Record<string, number>>;
          if (parsed && typeof parsed === "object") sizeStockMap = parsed;
        } catch {
          sizeStockMap = {};
        }
      }
      let next =
        !remote.error && remote.data !== null
          ? remote.data.filter((product) => !isDemoProduct(product)).map((product) => {
              const variants = variantsMap[product.sku]?.length ? variantsMap[product.sku] : product.variants || [];
              const configuredSizeStock = sizeStockMap[product.sku] || {};
              const sizes = sizesMap[product.sku]?.length
                ? sizesMap[product.sku]
                : product.sizes?.length
                  ? product.sizes
                  : Object.keys(configuredSizeStock).length
                    ? Object.keys(configuredSizeStock)
                  : Array.from(new Set(variants.map((variant) => variant.size).filter((size): size is string => Boolean(size))));
              const sizeStock = Object.keys(configuredSizeStock).length
                ? configuredSizeStock
                : Object.fromEntries(variants.filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!])) as Record<string, number>;
              const variantType = variantTypeMap[product.sku] || product.variantType || (sizes.length ? "size" : "normal");
              const stockSummary = getReportStockSummary({ stock: product.stock, variantType, sizes, sizeStock, variants });
              return {
                name: product.name,
                sku: product.sku,
                category: product.category,
                stock: stockSummary.stock,
                stockDetails: stockSummary.details,
                price: formatAdminCurrency(product.price),
                cost: formatAdminCurrency(product.cost ?? 0),
                status: product.status,
                image: product.image || adminPlaceholderImage,
                hoverImage: product.hoverImage || product.image || adminPlaceholderImage,
                gstRate: pricingMap[product.sku]?.gstRate || 0,
                markup: pricingMap[product.sku]?.markup || 0,
                sizes,
                sizeStock,
                variants,
                variantType,
              };
            })
          : adminProducts;
      setProducts(next);
    };
    void syncOrders();
    void syncProducts();
    const syncOrdersFromEvent = () => { void syncOrders(); };
    window.addEventListener("storage", syncOrdersFromEvent);
    window.addEventListener("storage", syncProducts);
    window.addEventListener("fanzzy-orders-updated", syncOrdersFromEvent);
    window.addEventListener("fanzzy-products-updated", syncProducts);
    return () => {
      active = false;
      window.removeEventListener("storage", syncOrdersFromEvent);
      window.removeEventListener("storage", syncProducts);
      window.removeEventListener("fanzzy-orders-updated", syncOrdersFromEvent);
      window.removeEventListener("fanzzy-products-updated", syncProducts);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const readLocalDamages = () => {
      const stored = window.localStorage.getItem(localProductDamagesKey);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as ProductDamageMap;
        if (active && parsed && typeof parsed === "object" && !Array.isArray(parsed)) setProductDamages(parsed);
      } catch {
        // Ignore malformed local damage history.
      }
    };
    const loadDamages = async () => {
      const remote = await fetchStoreSetting("productDamages");
      const stored = remote.value || window.localStorage.getItem(localProductDamagesKey);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as ProductDamageMap;
        if (active && parsed && typeof parsed === "object" && !Array.isArray(parsed)) setProductDamages(parsed);
      } catch {
        readLocalDamages();
      }
    };
    const runLoadDamages = () => { void loadDamages().catch(() => undefined); };
    runLoadDamages();
    window.addEventListener("fanzzy-product-damages-updated", readLocalDamages);
    window.addEventListener("storage", readLocalDamages);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-product-damages-updated", readLocalDamages);
      window.removeEventListener("storage", readLocalDamages);
    };
  }, []);

  const latestDate = new Date().toISOString().slice(0, 10);
  const filteredOrders = useMemo(() => {
    const { from, to } = reportDateBounds(period, latestDate, fromDate, toDate);
    return orders.filter((order) => order.date >= from && order.date <= to);
  }, [fromDate, latestDate, orders, period, toDate]);

  const filteredDamages = useMemo(() => {
    const { from, to } = reportDateBounds(period, latestDate, fromDate, toDate);
    return Object.values(productDamages)
      .flat()
      .filter((record) => {
        const date = String(record.createdAt || "").slice(0, 10);
        return date >= from && date <= to;
      })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }, [fromDate, latestDate, period, productDamages, toDate]);

  const report = useMemo(() => {
    const productsByKey = new Map<string, AdminProduct>();
    products.forEach((product) => {
      productsByKey.set(reportNameKey(product.name), product);
      productsByKey.set(reportNameKey(product.sku), product);
    });
    const salesProductRows: SalesProductReportRow[] = [];
    const sales = new Map<string, ProductReportRow>();
    products.forEach((product) => sales.set(product.sku, { product, units: 0, revenue: 0, stockDetails: getReportStockSummary(product).details }));
    filteredOrders.forEach((order) => {
      order.items?.forEach((item) => {
        const match = (item.productId && productsByKey.get(reportNameKey(item.productId))) || productsByKey.get(reportNameKey(item.name));
        const units = Math.max(0, Number(item.quantity) || 0);
        if (units === 0) return;
        const grossSales = parseReportMoney(item.price) * units;
        const gstRate = Math.max(0, Number(match?.gstRate) || 0);
        const totalGst = gstRate > 0 ? grossSales * gstRate / (100 + gstRate) : 0;
        const taxableSales = grossSales - totalGst;
        const unitCost = match ? parseReportMoney(match.cost) : 0;
        salesProductRows.push({
          invoiceNumber: getReportInvoiceNumber(order),
          orderId: order.id,
          customerName: order.customerName || "Not provided",
          date: order.date,
          productName: match?.name || item.name || item.productId || "Unknown product",
          sku: match?.sku || item.productId || "",
          units,
          unitRate: grossSales / units,
          grossSales,
          taxableSales,
          cgst: totalGst / 2,
          sgst: totalGst / 2,
          grossProfit: match ? taxableSales - unitCost * units : null,
        });
        if (!match) return;
        const row = sales.get(match.sku);
        if (!row) return;
        row.units += units;
        row.revenue += grossSales;
      });
    });
    const productRows = Array.from(sales.values()).map((row) => {
      const stockSummary = getReportStockSummary(row.product);
      const cost = parseReportMoney(row.product.cost) * row.units;
      const stockValue = parseReportMoney(row.product.price) * stockSummary.stock;
      const costValue = parseReportMoney(row.product.cost) * stockSummary.stock;
      return {
        ...row,
        stock: stockSummary.stock,
        stockDetails: stockSummary.details,
        cost,
        profit: row.revenue - cost,
        stockValue,
        costValue,
        movement: row.product.stock <= 0 ? "Out of stock" : row.units === 0 ? "No sales" : row.units < 3 ? "Slow moving" : "Moving",
      };
    });
    const topProducts = [...productRows].filter((row) => row.units > 0).sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, 10);
    const agedProducts = [...productRows].filter((row) => row.product.stock > 0).sort((a, b) => a.units - b.units || b.product.stock - a.product.stock).slice(0, 10);
    const inventoryRows = [...productRows].sort((a, b) => Number(a.product.stock > 0) - Number(b.product.stock > 0) || a.units - b.units || b.product.stock - a.product.stock);
    const categories = new Map<string, { products: number; units: number; revenue: number; profit: number; stockUnits: number; stockValue: number; costValue: number }>();
    productRows.forEach((row) => {
      const current = categories.get(row.product.category) ?? { products: 0, units: 0, revenue: 0, profit: 0, stockUnits: 0, stockValue: 0, costValue: 0 };
      current.products += 1;
      current.units += row.units;
      current.revenue += row.revenue;
      current.profit += row.profit;
      current.stockUnits += Math.max(0, row.product.stock);
      current.stockValue += row.stockValue;
      current.costValue += row.costValue;
      categories.set(row.product.category, current);
    });
    const categoryRows = Array.from(categories.entries()).map(([name, values]) => ({ name, ...values })).sort((a, b) => b.revenue - a.revenue || b.units - a.units);
    const damagedRows = filteredDamages.map((record) => {
      const product = (record.sku && productsByKey.get(reportNameKey(record.sku))) || productsByKey.get(reportNameKey(record.productName));
      const quantity = Math.max(0, Number(record.quantity) || 0);
      const unitPrice = product ? parseReportMoney(product.price) : 0;
      const unitCost = product ? parseReportMoney(product.cost) : 0;
      return {
        ...record,
        productName: product?.name || record.productName || record.sku,
        category: product?.category || "Archived product",
        quantity,
        unitPrice,
        unitCost,
        retailValue: unitPrice * quantity,
        costValue: unitCost * quantity,
      };
    });
    const totalRevenue = filteredOrders.reduce((sum, order) => sum + parseReportMoney(order.total), 0);
    const unitsSold = productRows.reduce((sum, row) => sum + row.units, 0);
    const stockValue = products.reduce((sum, product) => sum + parseReportMoney(product.price) * Math.max(0, product.stock), 0);
    const totalCost = productRows.reduce((sum, row) => sum + row.cost, 0);
    const statusNames = Array.from(new Set(["Delivered", "Processing", "Shipped", "Packed", "Cancelled", ...filteredOrders.map((order) => order.status)]));
    const statuses = statusNames.map((status) => ({
      name: status,
      count: filteredOrders.filter((order) => order.status === status).length,
    }));
    const daily = new Map<string, { revenue: number; orders: number; units: number }>();
    filteredOrders.forEach((order) => {
      const current = daily.get(order.date) ?? { revenue: 0, orders: 0, units: 0 };
      current.revenue += parseReportMoney(order.total);
      current.orders += 1;
      current.units += order.items?.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0) || 0;
      daily.set(order.date, current);
    });
    const dailyRows = Array.from(daily.entries()).map(([date, values]) => ({ date, ...values })).sort((a, b) => b.date.localeCompare(a.date));
    const payments = [
      { name: "Online", count: filteredOrders.filter((order) => order.paymentMethod !== "cod" && Boolean(order.razorpayPaymentId)).length, revenue: filteredOrders.filter((order) => order.paymentMethod !== "cod" && Boolean(order.razorpayPaymentId)).reduce((sum, order) => sum + parseReportMoney(order.total), 0) },
      { name: "COD", count: filteredOrders.filter((order) => order.paymentMethod === "cod").length, revenue: filteredOrders.filter((order) => order.paymentMethod === "cod").reduce((sum, order) => sum + parseReportMoney(order.total), 0) },
    ];
    const fulfilment = [
      { name: "Delivery", count: filteredOrders.filter((order) => order.fulfillmentMethod !== "pickup").length },
      { name: "Pickup", count: filteredOrders.filter((order) => order.fulfillmentMethod === "pickup").length },
    ];
    return {
      topProducts,
      agedProducts,
      inventoryRows,
      allProductRows: [...productRows].sort((a, b) => b.revenue - a.revenue || b.units - a.units),
      categoryRows,
      damagedRows,
      damagedUnits: damagedRows.reduce((sum, row) => sum + row.quantity, 0),
      damagedRetailValue: damagedRows.reduce((sum, row) => sum + row.retailValue, 0),
      damagedCostValue: damagedRows.reduce((sum, row) => sum + row.costValue, 0),
      salesProductRows,
      dailyRows,
      payments,
      fulfilment,
      orderRows: [...filteredOrders].sort((a, b) => b.date.localeCompare(a.date)),
      totalRevenue,
      unitsSold,
      stockValue,
      costValue: productRows.reduce((sum, row) => sum + row.costValue, 0),
      totalCost,
      grossProfit: totalRevenue - totalCost,
      averageOrder: filteredOrders.length ? totalRevenue / filteredOrders.length : 0,
      stockUnits: products.reduce((sum, product) => sum + Math.max(0, product.stock), 0),
      statuses,
      hasItemSales: unitsSold > 0,
    };
  }, [filteredDamages, filteredOrders, products]);

  const periodLabel = period === "today" ? "Today" : period === "this-week" ? "This week" : period === "this-month" ? "This month" : period === "last-month" ? "Last month" : period === "all-time" ? "All dates" : `${fromDate || "Start"} → ${toDate || "End"}`;
  const maxCategoryUnits = Math.max(1, report.categoryRows[0]?.units ?? 0);
  const showProductReport = view === "overview" || view === "item" || view === "top-selling";
  const showCategoryReport = view === "overview" || view === "category";
  const showInventoryReport = view === "overview" || view === "inventory";
  const showOrderReport = view === "overview" || view === "orders";
  const showDamagedReport = view === "overview" || view === "damaged";
  const detailTitle = view === "overview" ? "All report details" : view === "sales" ? "Sales report details" : view === "category" ? "Category report details" : view === "item" ? "Item report details" : view === "top-selling" ? "Top-selling item details" : view === "inventory" ? "Inventory / aged report details" : view === "orders" ? "Order status report details" : "Damaged items report details";
  const itemReportRows = report.allProductRows.filter((row) => {
    if (itemMovementFilter === "sales") return row.units > 0 && row.product.stock > 0;
    if (itemMovementFilter === "slow") return row.movement === "Slow moving";
    if (itemMovementFilter === "no-sales") return row.movement === "No sales";
    if (itemMovementFilter === "out-of-stock") return row.product.stock <= 0;
    return true;
  });
  const exportReport = () => {
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    let headers: string[] = [];
    let rows: unknown[][] = [];
    if (view === "sales") {
      headers = ["invoice_number", "order_id", "customer_name", "date", "product", "sku", "units_sold", "item_rate", "taxable_sales", "cgst", "sgst", "gross_sales", "gross_profit"];
      rows = report.salesProductRows.map((row) => [row.invoiceNumber, row.orderId, row.customerName, row.date, row.productName, row.sku, row.units, formatMoney(row.unitRate), formatMoney(row.taxableSales), formatMoney(row.cgst), formatMoney(row.sgst), formatMoney(row.grossSales), row.grossProfit === null ? "" : formatMoney(row.grossProfit)]);
    } else if (view === "category") {
      headers = ["category", "products", "units_sold", "revenue", "profit", "stock_units", "stock_value", "cost_value"];
      rows = report.categoryRows.map((category) => [category.name, category.products, category.units, formatAdminCurrency(category.revenue), formatAdminCurrency(category.profit), category.stockUnits, formatAdminCurrency(category.stockValue), formatAdminCurrency(category.costValue)]);
    } else if (view === "item") {
      headers = ["product", "sku", "category", "units_sold", "revenue", "profit", "stock", "stock_details", "stock_value", "cost_value", "movement"];
      rows = itemReportRows.map((row) => [row.product.name, row.product.sku, row.product.category, row.units, formatAdminCurrency(row.revenue), formatAdminCurrency(row.profit), row.stock, row.stockDetails, formatAdminCurrency(row.stockValue), formatAdminCurrency(row.costValue), row.movement]);
    } else if (view === "top-selling") {
      headers = ["rank", "product", "sku", "category", "units_sold", "revenue", "profit", "stock", "cost_value"];
      rows = report.topProducts.map((row, index) => [index + 1, row.product.name, row.product.sku, row.product.category, row.units, formatAdminCurrency(row.revenue), formatAdminCurrency(row.profit), row.product.stock, formatAdminCurrency(row.costValue)]);
    } else if (view === "inventory") {
      headers = ["product", "sku", "category", "status", "movement", "stock", "units_sold", "unit_price", "stock_value", "cost_value"];
      rows = report.inventoryRows.map((row) => [row.product.name, row.product.sku, row.product.category, row.product.status, row.movement, row.product.stock, row.units, formatAdminCurrency(parseReportMoney(row.product.price)), formatAdminCurrency(row.stockValue), formatAdminCurrency(row.costValue)]);
    } else if (view === "orders") {
      headers = ["order_id", "date", "customer", "status", "payment", "fulfilment", "items", "total", "phone", "email"];
      rows = report.orderRows.map((order) => [order.id, order.date, order.customerName, order.status, order.paymentMethod === "cod" ? "COD" : order.razorpayPaymentId ? "Online" : "Cash / other", order.fulfillmentMethod === "pickup" ? `Pickup · ${order.pickupHubName || "Hub"}` : "Delivery", order.items?.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0) || 0, order.total, order.userPhone || order.phone, order.userEmail || order.email || ""]);
    } else if (view === "damaged") {
      headers = ["date", "product", "sku", "category", "quantity", "stock_scope", "reason", "estimated_retail_value", "estimated_cost_value"];
      rows = report.damagedRows.map((row) => [row.createdAt.slice(0, 10), row.productName, row.sku, row.category, row.quantity, row.stockScope, row.reason, formatAdminCurrency(row.retailValue), formatAdminCurrency(row.costValue)]);
    } else {
      headers = ["report_section", "name", "value", "detail"];
      rows = [
        ["KPI", "Revenue", formatAdminCurrency(report.totalRevenue), periodLabel],
        ["KPI", "Units sold", report.unitsSold, "From order items"],
        ["KPI", "Orders", filteredOrders.length, periodLabel],
        ["KPI", "Gross profit", formatAdminCurrency(report.grossProfit), "Revenue less product cost"],
        ["KPI", "Average order", formatAdminCurrency(report.averageOrder), "Revenue divided by orders"],
        ["KPI", "Stock units", report.stockUnits, "Current catalog"],
        ["KPI", "Stock value", formatAdminCurrency(report.stockValue), "Current catalog"],
        ["KPI", "Cost value", formatAdminCurrency(report.costValue), "Current stock at cost"],
        ...report.dailyRows.map((day) => ["Daily sales", day.date, formatAdminCurrency(day.revenue), `${day.orders} orders · ${day.units} units`]),
        ...report.categoryRows.map((category) => ["Category", category.name, category.units, formatAdminCurrency(category.revenue)]),
        ...report.topProducts.map((row) => ["Top-selling item", row.product.name, row.units, formatAdminCurrency(row.revenue)]),
         ...report.inventoryRows.map((row) => ["Inventory", row.product.name, row.product.stock, `${row.units} units sold · ${row.movement}`]),
         ["Damaged items", "Units", report.damagedUnits, `${formatAdminCurrency(report.damagedCostValue)} estimated cost`],
         ...report.statuses.map((status) => ["Order status", status.name, status.count, "Orders"]),
      ];
    }
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fanzzy-${view === "overview" ? "all-reports" : `${view}-report`}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    onNotify("Report exported");
  };

  return (
    <section className="panel module-workspace reports-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">ANALYTICS</p>
          <h2>Store reports</h2>
          <p>See what sells, what is slowing down, and where your store is strongest.</p>
        </div>
        <div className="report-period-control">
          <button className="module-secondary report-export-button" onClick={exportReport}>Export report ↗</button>
          <label>
            {view === "sales" ? "Sales filter" : "Report period"}
            <select value={period} onChange={(event) => setPeriod(event.target.value as ReportPeriod)}>
              <option value="today">Today</option>
              <option value="this-week">This week</option>
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="all-time">All dates</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {period === "custom" && <div className="report-date-fields"><label>Start<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label><label>End<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label></div>}
        </div>
      </div>
      <div className="module-summary"><span><i className="status-light" />{periodLabel}</span><span>{filteredOrders.length} orders analyzed</span></div>
      <div className="report-kpi-grid">
        <div className="report-kpi"><small>Revenue</small><strong>{formatAdminCurrency(report.totalRevenue)}</strong><span>{periodLabel}</span></div>
        <div className="report-kpi"><small>Units sold</small><strong>{report.unitsSold}</strong><span>From order items</span></div>
        <div className="report-kpi"><small>Orders</small><strong>{filteredOrders.length}</strong><span>Selected period</span></div>
        <div className="report-kpi"><small>Gross profit</small><strong>{formatAdminCurrency(report.grossProfit)}</strong><span>Revenue less cost</span></div>
        <div className="report-kpi"><small>Average order</small><strong>{formatAdminCurrency(report.averageOrder)}</strong><span>Per confirmed order</span></div>
        <div className="report-kpi"><small>Stock units</small><strong>{report.stockUnits}</strong><span>Current catalog</span></div>
        <div className="report-kpi"><small>Stock value</small><strong>{formatAdminCurrency(report.stockValue)}</strong><span>Current catalog</span></div>
        <div className="report-kpi"><small>Cost value</small><strong>{formatAdminCurrency(report.costValue)}</strong><span>Current stock at cost</span></div>
      </div>
      <div className="reports-grid">
        {showProductReport && <article className="report-card report-card-wide">
          <div className="report-card-head"><div><p className="eyebrow">PRODUCT PERFORMANCE</p><h3>{view === "top-selling" ? "Top-selling items" : "Item performance"}</h3></div><span>Units sold</span></div>
          {report.hasItemSales ? <div className="report-table">{report.topProducts.map((row, index) => <div className="report-row" key={row.product.sku}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{row.product.name}</strong><small>{row.product.category}</small></span><em>{row.units} units</em><strong>{formatAdminCurrency(row.revenue)}</strong></div>)}</div> : <div className="report-empty">Item-level sales will appear here after orders include products.</div>}
        </article>}
        {showCategoryReport && <article className="report-card">
          <div className="report-card-head"><div><p className="eyebrow">CATEGORY PERFORMANCE</p><h3>Best-selling categories</h3></div></div>
          <div className="category-report-list">{report.categoryRows.map((category) => <div className="category-report-row" key={category.name}><div><strong>{category.name}</strong><span>{category.units} units · {formatAdminCurrency(category.revenue)}</span></div><div className="category-report-bar"><i style={{ width: `${Math.max(5, (category.units / maxCategoryUnits) * 100)}%` }} /></div></div>)}</div>
        </article>}
         {showInventoryReport && <article className="report-card">
           <div className="report-card-head"><div><p className="eyebrow">INVENTORY HEALTH</p><h3>Slow / aged inventory</h3></div><span>Lowest movement</span></div>
           <div className="report-table">{report.agedProducts.map((row) => <div className="report-row aged-report-row" key={row.product.sku}><span><strong>{row.product.name}</strong><small>{row.units ? `${row.units} units sold` : "No recorded sales"}</small></span><em>{row.product.stock} in stock</em><strong>{formatAdminCurrency(parseReportMoney(row.product.price) * row.product.stock)}</strong></div>)}</div>
           <p className="report-help">Prioritise these products for a campaign, bundle, or clearance review.</p>
         </article>}
         {showDamagedReport && <article className="report-card">
           <div className="report-card-head"><div><p className="eyebrow">DAMAGE REPORT</p><h3>Damaged items</h3></div><span>{report.damagedRows.length} records</span></div>
           {report.damagedRows.length ? <div className="report-table">{report.damagedRows.slice(0, 5).map((row) => <div className="report-row aged-report-row" key={row.id}><span><strong>{row.productName}</strong><small>{row.reason}</small></span><em>{row.quantity} unit{row.quantity === 1 ? "" : "s"}</em><strong>{formatAdminCurrency(row.costValue)}</strong></div>)}</div> : <div className="report-empty">No damaged items in this period.</div>}
           <p className="report-help">Estimated cost value: {formatAdminCurrency(report.damagedCostValue)} · {report.damagedUnits} units removed.</p>
         </article>}
         {showOrderReport && <article className="report-card">
          <div className="report-card-head"><div><p className="eyebrow">ORDER HEALTH</p><h3>Order status report</h3></div></div>
          <div className="status-report-list">{report.statuses.map((status) => <div key={status.name}><span>{status.name}</span><strong>{status.count}</strong></div>)}</div>
          <button className="report-link" onClick={() => onNotify("Open Orders to manage fulfilment")}>Manage orders ↗</button>
        </article>}
      </div>
      <section className="report-detail-panel">
        <div className="report-detail-head"><div><p className="eyebrow">FULL BREAKDOWN</p><h3>{detailTitle}</h3><span>{periodLabel} · {filteredOrders.length} confirmed orders · {products.length} catalog items</span></div><span className="report-detail-note">Use Export report for the same detail in CSV format.</span></div>
        {view === "overview" && <div className="report-detail-split">
          <div className="report-detail-block"><div className="report-detail-block-head"><strong>Daily sales detail</strong><span>{report.dailyRows.length} active dates</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Date</th><th>Orders</th><th>Units</th><th>Revenue</th></tr></thead><tbody>{report.dailyRows.length ? report.dailyRows.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.orders}</td><td>{day.units}</td><td>{formatAdminCurrency(day.revenue)}</td></tr>) : <tr><td colSpan={4}>No confirmed sales in this period.</td></tr>}</tbody></table></div></div>
        </div>}
        {view === "sales" && <div className="report-detail-split">
          <div className="report-detail-block"><div className="report-detail-block-head"><strong>Daily sales detail</strong><span>{report.dailyRows.length} active dates</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Date</th><th>Orders</th><th>Units</th><th>Revenue</th></tr></thead><tbody>{report.dailyRows.length ? report.dailyRows.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.orders}</td><td>{day.units}</td><td>{formatAdminCurrency(day.revenue)}</td></tr>) : <tr><td colSpan={4}>No confirmed sales in this period.</td></tr>}</tbody></table></div></div>
        </div>}
        {view === "sales" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Payment &amp; fulfilment</strong><span>Order mix</span></div><div className="report-mini-list">{report.payments.map((payment) => <div key={payment.name}><span>{payment.name}<small>{formatAdminCurrency(payment.revenue)}</small></span><strong>{payment.count}</strong></div>)}{report.fulfilment.map((method) => <div key={method.name}><span>{method.name}<small>Fulfilment method</small></span><strong>{method.count}</strong></div>)}</div></div>}
        {view === "sales" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Sales by product</strong><span>{report.salesProductRows.length} product lines</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Invoice number</th><th>Order ID</th><th>Customer name</th><th>Date</th><th>Product</th><th>SKU</th><th>Units</th><th>Item rate</th><th>Taxable sales</th><th>CGST</th><th>SGST</th><th>Gross sales</th><th>Gross profit</th></tr></thead><tbody>{report.salesProductRows.length ? report.salesProductRows.map((row, index) => <tr key={`${row.orderId}-${row.sku}-${index}`}><td>{row.invoiceNumber}</td><td>{row.orderId}</td><td>{row.customerName}</td><td>{row.date}</td><td>{row.productName}</td><td>{row.sku || "—"}</td><td>{row.units}</td><td>{formatMoney(row.unitRate)}</td><td>{formatMoney(row.taxableSales)}</td><td>{formatMoney(row.cgst)}</td><td>{formatMoney(row.sgst)}</td><td>{formatMoney(row.grossSales)}</td><td>{row.grossProfit === null ? "Unavailable" : formatMoney(row.grossProfit)}</td></tr>) : <tr><td colSpan={13}>No confirmed sales in this period.</td></tr>}</tbody></table></div><p className="report-help">Item rate is the gross selling rate for one unit. CGST and SGST are split equally from the GST included in each product sale. Gross profit is taxable sales less product cost. Decimal values are shown up to 2 places.</p></div>}
        {view === "overview" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Category summary</strong><span>{report.categoryRows.length} categories</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Category</th><th>Products</th><th>Units sold</th><th>Revenue</th><th>Profit</th><th>Stock value</th><th>Cost value</th></tr></thead><tbody>{report.categoryRows.map((category) => <tr key={category.name}><td>{category.name}</td><td>{category.products}</td><td>{category.units}</td><td>{formatAdminCurrency(category.revenue)}</td><td>{formatAdminCurrency(category.profit)}</td><td>{formatAdminCurrency(category.stockValue)}</td><td>{formatAdminCurrency(category.costValue)}</td></tr>)}</tbody></table></div></div>}
        {view === "category" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Every category</strong><span>{report.categoryRows.length} rows</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Category</th><th>Products</th><th>Units sold</th><th>Revenue</th><th>Profit</th><th>Stock units</th><th>Stock value</th><th>Cost value</th></tr></thead><tbody>{report.categoryRows.map((category) => <tr key={category.name}><td>{category.name}</td><td>{category.products}</td><td>{category.units}</td><td>{formatAdminCurrency(category.revenue)}</td><td>{formatAdminCurrency(category.profit)}</td><td>{category.stockUnits}</td><td>{formatAdminCurrency(category.stockValue)}</td><td>{formatAdminCurrency(category.costValue)}</td></tr>)}</tbody></table></div></div>}
        {(view === "item" || view === "top-selling") && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><div><strong>{view === "top-selling" ? "Ranked best sellers" : "Every catalog item"}</strong><span>{view === "top-selling" ? report.topProducts.length : itemReportRows.length} rows</span></div>{view === "item" && <label className="report-table-filter">Filter items<select value={itemMovementFilter} onChange={(event) => setItemMovementFilter(event.target.value as ReportMovementFilter)}><option value="all">All items</option><option value="sales">Sales items</option><option value="slow">Slow moving</option><option value="no-sales">No sales</option><option value="out-of-stock">Out of stock</option></select></label>}</div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>{view === "top-selling" ? "Rank" : "Product"}</th><th>{view === "top-selling" ? "Product" : "SKU"}</th><th>Category</th><th>Units</th><th>Revenue</th><th>Profit</th><th>Stock</th>{view === "item" && <th>Stock details</th>}<th>Stock value</th><th>Cost value</th><th>Movement</th></tr></thead><tbody>{(view === "top-selling" ? report.topProducts : itemReportRows).map((row, index) => <tr key={row.product.sku}><td>{view === "top-selling" ? String(index + 1).padStart(2, "0") : row.product.name}</td><td>{view === "top-selling" ? row.product.name : row.product.sku}</td><td>{row.product.category}</td><td>{row.units}</td><td>{formatAdminCurrency(row.revenue)}</td><td>{formatAdminCurrency(row.profit)}</td><td>{row.stock}</td>{view === "item" && <td>{row.stockDetails}</td>}<td>{formatAdminCurrency(row.stockValue)}</td><td>{formatAdminCurrency(row.costValue)}</td><td><span className={`report-movement ${row.movement.toLowerCase().replace(/\s+/g, "-")}`}>{row.movement}</span></td></tr>)}</tbody></table></div>{view === "item" && <p className="report-help">Stock and cost value include variant or size stock when those quantities are configured. Stock details shows the quantity for each option.</p>}</div>}
        {view === "inventory" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Complete inventory movement</strong><span>{report.inventoryRows.length} products</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Status</th><th>Movement</th><th>Stock</th><th>Units sold</th><th>Unit price</th><th>Stock value</th><th>Cost value</th></tr></thead><tbody>{report.inventoryRows.map((row) => <tr key={row.product.sku}><td>{row.product.name}</td><td>{row.product.sku}</td><td>{row.product.category}</td><td>{row.product.status}</td><td><span className={`report-movement ${row.movement.toLowerCase().replace(/\s+/g, "-")}`}>{row.movement}</span></td><td>{row.product.stock}</td><td>{row.units}</td><td>{formatAdminCurrency(parseReportMoney(row.product.price))}</td><td>{formatAdminCurrency(row.stockValue)}</td><td>{formatAdminCurrency(row.costValue)}</td></tr>)}</tbody></table></div></div>}
         {view === "orders" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Every confirmed order</strong><span>{report.orderRows.length} orders</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Status</th><th>Payment</th><th>Fulfilment</th><th>Items</th><th>Total</th><th>Phone</th></tr></thead><tbody>{report.orderRows.length ? report.orderRows.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.date}</td><td>{order.customerName}</td><td><span className={`report-order-status ${order.status.toLowerCase()}`}>{order.status}</span></td><td>{order.paymentMethod === "cod" ? "COD" : order.razorpayPaymentId ? "Online" : "Cash / other"}</td><td>{order.fulfillmentMethod === "pickup" ? `Pickup · ${order.pickupHubName || "Hub"}` : "Delivery"}</td><td>{order.items?.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0) || 0}</td><td>{order.total}</td><td>{order.userPhone || order.phone}</td></tr>) : <tr><td colSpan={9}>No confirmed orders in this period.</td></tr>}</tbody></table></div></div>}
         {view === "damaged" && <div className="report-detail-block report-detail-wide"><div className="report-detail-block-head"><strong>Every damaged item</strong><span>{report.damagedRows.length} records · {report.damagedUnits} units</span></div><div className="report-table-wrap"><table className="report-detail-table"><thead><tr><th>Date</th><th>Product</th><th>SKU</th><th>Category</th><th>Quantity</th><th>Scope</th><th>Reason</th><th>Retail value</th><th>Cost value</th></tr></thead><tbody>{report.damagedRows.length ? report.damagedRows.map((row) => <tr key={row.id}><td>{row.createdAt.slice(0, 10)}</td><td>{row.productName}</td><td>{row.sku}</td><td>{row.category}</td><td>{row.quantity}</td><td>{row.stockScope}</td><td>{row.reason}</td><td>{formatAdminCurrency(row.retailValue)}</td><td>{formatAdminCurrency(row.costValue)}</td></tr>) : <tr><td colSpan={9}>No damaged items in this period.</td></tr>}</tbody></table></div></div>}
      </section>
    </section>
  );
}

type SettingsSection = "Store profile" | "Shipping rules" | "Payment methods" | "Printer" | "Bill design" | "Admin roles";

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
  const [payments, setPayments] = useState<PaymentSettings>(defaultPaymentSettings);
  const [printerName, setPrinterName] = useState("Essae PR-55");
  const [billDesign, setBillDesign] = useState<BillDesignSettings>(defaultBillDesignSettings);
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
    setPayments(parsePaymentSettings(read("fanzzy-payment-methods", defaultPaymentSettings)));
    setPrinterName(window.localStorage.getItem("fanzzy-printer-name")?.replace("Essae PR 55", "Essae PR-55") || "Essae PR-55");
    setBillDesign(read("fanzzy-bill-design", defaultBillDesignSettings));
    void fetchStoreSetting("printerName").then((remote) => {
      if (!remote.error && remote.value) {
        const normalizedPrinter = remote.value.replace("Essae PR 55", "Essae PR-55");
        setPrinterName(normalizedPrinter);
        window.localStorage.setItem("fanzzy-printer-name", normalizedPrinter);
      }
    });
    void fetchStoreSetting("billDesign").then((remote) => {
      if (!remote.error && remote.value) {
        try {
          const normalizedDesign = { ...defaultBillDesignSettings, ...(JSON.parse(remote.value) as Partial<BillDesignSettings>) };
          setBillDesign(normalizedDesign);
          window.localStorage.setItem("fanzzy-bill-design", JSON.stringify(normalizedDesign));
        } catch {
          // Keep the local/default design when a remote value is malformed.
        }
      }
    });
    void fetchStoreSetting("paymentMethods").then((remote) => {
      if (!remote.error && remote.value) {
        try {
          const normalizedPayments = parsePaymentSettings(JSON.parse(remote.value) as unknown);
          setPayments(normalizedPayments);
          window.localStorage.setItem("fanzzy-payment-methods", JSON.stringify(normalizedPayments));
        } catch {
          // Keep the local/default payment settings when the remote value is malformed.
        }
      }
    });
    setRoles(defaultAdminRoles);
    window.localStorage.setItem("fanzzy-admin-roles", JSON.stringify(defaultAdminRoles));
    // These values are only read on mount; the defaults above provide the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = () => {
    window.localStorage.setItem("fanzzy-store-profile", JSON.stringify(profile));
    window.localStorage.setItem("fanzzy-shipping-rules", JSON.stringify(shipping));
    window.localStorage.setItem("fanzzy-payment-methods", JSON.stringify(payments));
    void saveStoreSetting("paymentMethods", JSON.stringify(payments));
    window.dispatchEvent(new Event("fanzzy-payment-methods-updated"));
    window.localStorage.setItem("fanzzy-printer-name", printerName);
    void saveStoreSetting("printerName", printerName);
    window.localStorage.setItem("fanzzy-bill-design", JSON.stringify(billDesign));
    void saveStoreSetting("billDesign", JSON.stringify(billDesign));
    window.localStorage.setItem("fanzzy-admin-roles", JSON.stringify(roles));
    window.dispatchEvent(new Event("fanzzy-store-settings-updated"));
    onNotify("Store settings saved");
  };

  const statusFor = (section: SettingsSection) => {
    if (section === "Store profile") return profile.storeName ? "Configured" : "Needs details";
    if (section === "Shipping rules") return `${Object.values(shipping).filter(Boolean).length} active`;
    if (section === "Payment methods") return `${payments.online || payments.cod ? `${payments.provider} · ${payments.cod ? `COD ₹${payments.codCharge}` : "online only"}` : "No methods active"}`;
    if (section === "Printer") return printerName || "Needs selection";
    if (section === "Bill design") return billDesign.logoText ? `${billDesign.logoText} ready` : "Needs design";
    return "1 full access role";
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
        {(["Store profile", "Shipping rules", "Payment methods", "Printer", "Bill design", "Admin roles"] as SettingsSection[]).map((section, index) => (
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
            <label>COD charge (₹)<input type="number" min="0" value={payments.codCharge} onChange={(event) => setPayments((current) => ({ ...current, codCharge: Math.max(0, Number(event.target.value) || 0) }))} /><small className="settings-upload-name">Added to the customer total when COD is selected.</small></label>
          </div>}

          {selectedSection === "Printer" && <div className="settings-form-grid">
            <label className="settings-wide">Printer selection<select value="browser" disabled><option value="browser">Choose printer when printing</option></select></label>
          <p className="settings-help settings-wide">Bills open the browser printer window, not a PDF download. If it shows “Save to PDF” by default, open Destination and select any printer installed on this device, including an 80 mm thermal printer.</p>
          </div>}

          {selectedSection === "Bill design" && <div className="settings-form-grid bill-design-settings">
            <label className="settings-wide">Top logo<select value={billDesign.showLogo ? billDesign.logoAsset : "none"} onChange={(event) => setBillDesign((current) => ({ ...current, showLogo: event.target.value !== "none", logoAsset: event.target.value === "custom" ? "custom" : "fanzzy-mark.png" }))}><option value="fanzzy-mark.png">Fanzzy logo mark</option><option value="custom">Uploaded logo</option><option value="none">Text logo only</option></select></label>
            <label className="settings-wide">Upload logo PNG / JPG<input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const result = typeof reader.result === "string" ? reader.result : ""; if (result) setBillDesign((current) => ({ ...current, showLogo: true, logoAsset: "custom", logoDataUrl: result })); }; reader.readAsDataURL(file); }} /><small className="settings-upload-name">{billDesign.logoDataUrl ? "Uploaded logo ready" : "Choose a logo image for the top of the bill."}</small></label>
            {billDesign.showLogo && <div className="bill-logo-preview settings-wide"><img src={billDesign.logoDataUrl || "/fanzzy-mark.png"} alt="Bill logo preview" /><span>{billDesign.logoAsset === "custom" && billDesign.logoDataUrl ? "Custom logo" : "Fanzzy logo mark"}</span></div>}
            <label className="settings-wide">Bill QR code<select value={billDesign.showQrCode ? billDesign.qrCodeAsset : "none"} onChange={(event) => setBillDesign((current) => ({ ...current, showQrCode: event.target.value !== "none", qrCodeAsset: event.target.value === "custom" ? "custom" : "vestano-retail-qr-code.png" }))}><option value="vestano-retail-qr-code.png">Vestano QR code</option><option value="custom">Uploaded QR code</option><option value="none">No QR code</option></select></label>
            <label className="settings-wide">Upload QR code PNG / JPG<input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const result = typeof reader.result === "string" ? reader.result : ""; if (result) setBillDesign((current) => ({ ...current, showQrCode: true, qrCodeAsset: "custom", qrCodeDataUrl: result })); }; reader.readAsDataURL(file); }} /><small className="settings-upload-name">{billDesign.qrCodeDataUrl ? "Uploaded QR code ready" : "Choose a QR image for the bill footer."}</small></label>
            {billDesign.showQrCode && <div className="bill-logo-preview settings-wide"><img src={billDesign.qrCodeDataUrl || "/vestano-retail-qr-code.png"} alt="Bill QR code preview" /><span>{billDesign.qrCodeAsset === "custom" && billDesign.qrCodeDataUrl ? "Custom QR code" : "Vestano QR code"}</span></div>}
            <label>Logo / brand text<input value={billDesign.logoText} onChange={(event) => setBillDesign((current) => ({ ...current, logoText: event.target.value }))} placeholder="fanZZy" /></label>
            <label>Top tagline<input value={billDesign.tagline} onChange={(event) => setBillDesign((current) => ({ ...current, tagline: event.target.value }))} placeholder="JEWELLERY WITH INTENTION" /></label>
            <label>Separator style<select value={billDesign.separator} onChange={(event) => setBillDesign((current) => ({ ...current, separator: event.target.value as BillDesignSettings["separator"] }))}><option value="dotted">Dotted</option><option value="dashed">Dashed</option></select></label>
            <label>Thank-you text<input value={billDesign.thankYouText} onChange={(event) => setBillDesign((current) => ({ ...current, thankYouText: event.target.value }))} /></label>
            <div className="settings-check-grid settings-wide">
              <label className="settings-check"><input type="checkbox" checked={billDesign.showStatus} onChange={(event) => setBillDesign((current) => ({ ...current, showStatus: event.target.checked }))} /><span>Show order status</span></label>
              <label className="settings-check"><input type="checkbox" checked={billDesign.showPhone} onChange={(event) => setBillDesign((current) => ({ ...current, showPhone: event.target.checked }))} /><span>Show customer phone</span></label>
              <label className="settings-check"><input type="checkbox" checked={billDesign.showAddress} onChange={(event) => setBillDesign((current) => ({ ...current, showAddress: event.target.checked }))} /><span>Show delivery address</span></label>
            </div>
            <p className="settings-help settings-wide">These options change the receipt shown in the browser print dialog. Save changes, then print a new bill.</p>
          </div>}

          {selectedSection === "Admin roles" && <div className="settings-roles-form"><div className="settings-role-list"><div className="settings-role-card"><div className="settings-role-fixed"><div><strong>Vestano</strong><small>Super admin</small></div><span>Full access</span></div><p className="settings-role-access-copy">This is the only admin role. It can access every workspace section and all store settings.</p></div></div></div>}

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
const defaultCollections: CollectionRecord[] = [];

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
const defaultCustomers: CustomerRecord[] = [];

const customerIdentity = (customer: Pick<CustomerRecord, "name" | "phone" | "email">) =>
  customer.phone.replace(/\D/g, "") || customer.email.trim().toLowerCase() || customer.name.trim().toLowerCase();

const customersFromOrders = (orders: OrderRecord[]): CustomerRecord[] => {
  const grouped = new Map<string, CustomerRecord & { lastOrderValue: number; joinedValue: number }>();
  orders.filter(hasConfirmedPayment).forEach((order) => {
    const name = order.customerName?.trim() || "Guest customer";
    const phone = (order.userPhone || order.phone || "").trim();
    const email = (order.userEmail || order.email || "").trim();
    const identity = customerIdentity({ name, phone, email });
    if (!identity) return;
    const orderValue = Number.isFinite(new Date(order.createdAt || order.date).getTime())
      ? new Date(order.createdAt || order.date).getTime()
      : 0;
    const current = grouped.get(identity);
    if (current) {
      current.orders += 1;
      current.totalSpent = formatAdminCurrency(parseMoney(current.totalSpent) + parseMoney(order.total));
      if (orderValue >= current.lastOrderValue) {
        current.lastOrder = order.date || order.createdAt || current.lastOrder;
        current.lastOrderValue = orderValue;
      }
      if (orderValue > 0 && orderValue < current.joinedValue) {
        current.joined = order.date || order.createdAt || current.joined;
        current.joinedValue = orderValue;
      }
      if (current.email === "Not provided" && email) current.email = email;
      if (current.phone === "Not provided" && phone) current.phone = phone;
      if (current.address === "Not provided" && order.address?.trim()) current.address = order.address.trim();
      return;
    }
    grouped.set(identity, {
      id: `customer-order-${identity}`,
      name,
      phone: phone || "Not provided",
      email: email || "Not provided",
      address: order.address?.trim() || "Not provided",
      orders: 1,
      totalSpent: formatAdminCurrency(parseMoney(order.total)),
      lastOrder: order.date || order.createdAt || "Unknown",
      joined: order.date || order.createdAt || "Unknown",
      lastOrderValue: orderValue,
      joinedValue: orderValue,
    });
  });
  return Array.from(grouped.values())
    .sort((left, right) => right.lastOrderValue - left.lastOrderValue)
    .map(({ lastOrderValue: _lastOrderValue, joinedValue: _joinedValue, ...customer }) => customer);
};

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
      const [remote, ordersRemote] = await Promise.all([
        fetchStoreSetting("customers"),
        fetchStoreOrders<OrderRecord>(),
      ]);
      const stored = remote.value || window.localStorage.getItem("fanzzy-customers");
      let savedCustomers: CustomerRecord[] = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as CustomerRecord[];
          if (Array.isArray(parsed)) savedCustomers = parsed;
        } catch {
          window.localStorage.removeItem("fanzzy-customers");
        }
      }
      const localOrders: OrderRecord[] = (() => {
        try {
          const parsed = JSON.parse(window.localStorage.getItem("fanzzy-orders") || "[]") as OrderRecord[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      const remoteOrders = ordersRemote.data || [];
      const orders = new Map<string, OrderRecord>();
      [...remoteOrders, ...localOrders].forEach((order) => {
        if (order?.id && !orders.has(order.id)) orders.set(order.id, order);
      });
      const derivedCustomers = customersFromOrders(Array.from(orders.values()));
      const mergedCustomers = [...savedCustomers];
      derivedCustomers.forEach((customer) => {
        const matchIndex = mergedCustomers.findIndex((saved) => customerIdentity(saved) === customerIdentity(customer));
        if (matchIndex === -1) mergedCustomers.push(customer);
        else mergedCustomers[matchIndex] = { ...mergedCustomers[matchIndex], ...customer, id: mergedCustomers[matchIndex].id };
      });
      if (active) setCustomers(mergedCustomers);
    };
    void loadCustomers();
    const syncCustomers = () => void loadCustomers();
    const unsubscribeFromOrders = subscribeToStoreSetting("orders", syncCustomers);
    window.addEventListener("storage", syncCustomers);
    window.addEventListener("fanzzy-orders-updated", syncCustomers);
    window.addEventListener("fanzzy-customers-updated", syncCustomers);
    return () => {
      active = false;
      unsubscribeFromOrders();
      window.removeEventListener("storage", syncCustomers);
      window.removeEventListener("fanzzy-orders-updated", syncCustomers);
      window.removeEventListener("fanzzy-customers-updated", syncCustomers);
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

function AgentsWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [agents, setAgents] = useState<CatalogAgent[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [couponCodeTouched, setCouponCodeTouched] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", couponCode: "", discountPercent: "10" });

  const normalizeCode = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();
  const generateAgentCouponCode = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let candidate = "";
    do {
      const bytes = new Uint8Array(6);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
      const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
      candidate = `FANZZY-${suffix}`;
    } while (agents.some((agent) => agent.couponCode === candidate));
    return candidate;
  };
  const parseAgents = (value: string | null) => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as Array<Partial<CatalogAgent>>;
      return Array.isArray(parsed)
        ? parsed
            .filter((agent) => agent?.id && agent?.name && agent?.couponCode)
            .map((agent) => ({
              id: String(agent.id),
              name: String(agent.name).trim(),
              phone: String(agent.phone || "").trim(),
              couponCode: normalizeCode(String(agent.couponCode)),
              discountPercent: Math.min(100, Math.max(1, Number(agent.discountPercent) || 1)),
              status: agent.status === "Paused" ? "Paused" : "Active",
              createdAt: agent.createdAt || undefined,
            }))
        : [];
    } catch {
      return [];
    }
  };

  const loadWorkspace = async () => {
    const [agentsRemote, ordersRemote] = await Promise.all([
      fetchStoreSetting("agents"),
      fetchStoreOrders<OrderRecord>(),
    ]);
    const storedAgents = agentsRemote.value || window.localStorage.getItem("fanzzy-agents");
    const nextAgents = parseAgents(storedAgents);
    setAgents(nextAgents);
    if (storedAgents && !agentsRemote.value && nextAgents.length) await saveStoreSetting("agents", JSON.stringify(nextAgents));

    const orderMap = new Map<string, OrderRecord>();
    ordersRemote.data?.forEach((order) => { if (order?.id) orderMap.set(order.id, order); });
    try {
      const storedOrders = JSON.parse(window.localStorage.getItem("fanzzy-orders") || "[]") as OrderRecord[];
      if (Array.isArray(storedOrders)) storedOrders.forEach((order) => { if (order?.id && !orderMap.has(order.id)) orderMap.set(order.id, order); });
    } catch {
      // Ignore malformed local order cache.
    }
    setOrders(Array.from(orderMap.values()).filter((order) => !isDemoOrder(order) && hasConfirmedPayment(order)));
  };

  useEffect(() => {
    void loadWorkspace();
    window.addEventListener("storage", loadWorkspace);
    window.addEventListener("fanzzy-agents-updated", loadWorkspace);
    window.addEventListener("fanzzy-orders-updated", loadWorkspace);
    return () => {
      window.removeEventListener("storage", loadWorkspace);
      window.removeEventListener("fanzzy-agents-updated", loadWorkspace);
      window.removeEventListener("fanzzy-orders-updated", loadWorkspace);
    };
  }, []);

  const persist = async (next: CatalogAgent[], message: string) => {
    setAgents(next);
    window.localStorage.setItem("fanzzy-agents", JSON.stringify(next));
    const remoteError = await saveStoreSetting("agents", JSON.stringify(next));
    window.dispatchEvent(new Event("fanzzy-agents-updated"));
    onNotify(remoteError ? `${message} locally; Supabase needs setup` : message);
  };

  const openNew = () => {
    setEditingId(null);
    setCouponCodeTouched(false);
    setForm({ name: "", phone: "", couponCode: generateAgentCouponCode(), discountPercent: "10" });
    setFormOpen(true);
  };

  const openEdit = (agent: CatalogAgent) => {
    setEditingId(agent.id);
    setCouponCodeTouched(true);
    setForm({ name: agent.name, phone: agent.phone, couponCode: agent.couponCode, discountPercent: String(agent.discountPercent) });
    setFormOpen(true);
  };

  const saveAgent = async () => {
    const name = form.name.trim();
    const phone = form.phone.trim();
    const couponCode = normalizeCode(form.couponCode);
    const discountPercent = Number(form.discountPercent);
    if (!name || !phone || !couponCode) return onNotify("Add the agent name, phone number, and coupon code");
    if (!/^[A-Z0-9_-]{3,32}$/.test(couponCode)) return onNotify("Coupon code must be 3–32 letters or numbers");
    if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) return onNotify("Discount must be between 1% and 100%");
    if (agents.some((agent) => agent.id !== editingId && agent.couponCode === couponCode)) return onNotify("That coupon code is already assigned to another agent");

    const marketingRemote = await fetchStoreSetting("marketingRecords");
    const marketingRecords = (() => {
      try { return JSON.parse(marketingRemote.value || window.localStorage.getItem("fanzzy-marketing-records") || "[]") as MarketingRecord[]; } catch { return []; }
    })();
    if (marketingRecords.some((record) => record.kind === "Coupon" && normalizeCode(record.code || "") === couponCode)) return onNotify("That coupon code is already used by Marketing");

    const agent: CatalogAgent = {
      id: editingId || `agent-${Date.now()}`,
      name,
      phone,
      couponCode,
      discountPercent: Math.round(discountPercent * 100) / 100,
      status: editingId ? agents.find((item) => item.id === editingId)?.status || "Active" : "Active",
      createdAt: editingId ? agents.find((item) => item.id === editingId)?.createdAt : new Date().toISOString(),
    };
    const next = editingId ? agents.map((item) => item.id === editingId ? agent : item) : [agent, ...agents];
    await persist(next, editingId ? "Agent updated" : "Agent created");
    setFormOpen(false);
  };

  const removeAgent = async (agent: CatalogAgent) => {
    if (!window.confirm(`Delete ${agent.name} and stop its coupon?`)) return;
    await persist(agents.filter((item) => item.id !== agent.id), `${agent.name} deleted`);
  };

  const toggleAgent = async (agent: CatalogAgent) => {
    const nextStatus = agent.status === "Active" ? "Paused" : "Active";
    await persist(agents.map((item) => item.id === agent.id ? { ...item, status: nextStatus } : item), `${agent.name} ${nextStatus === "Active" ? "activated" : "paused"}`);
  };

  const statsFor = (agent: CatalogAgent) => {
    const agentOrders = orders.filter((order) => normalizeCode(order.coupon || "") === agent.couponCode);
    const customers = new Set(agentOrders.map((order) => (order.phone || order.userPhone || order.email || order.customerName || order.id).trim().toLowerCase()));
    const pieces = agentOrders.reduce((total, order) => total + (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0), 0);
    const billAmount = agentOrders.reduce((total, order) => total + parseMoney(order.total), 0);
    const discountAmount = agentOrders.reduce((total, order) => total + (Number(order.couponDiscount) || 0), 0);
    const agentPayoutAmount = Math.round(billAmount * 10) / 100;
    return { orders: agentOrders.length, customers: customers.size, pieces, billAmount, discountAmount, agentPayoutAmount };
  };
  const totalTrackedOrders = agents.reduce((total, agent) => total + statsFor(agent).orders, 0);

  return (
    <section className="panel module-workspace agents-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">PARTNER SALES</p>
          <h2>Agent coupons</h2>
          <p>Create a unique discount code for each agent and see exactly how many customers, orders, and pieces came through that code.</p>
        </div>
        <button className="module-primary" onClick={openNew}>+ Add agent</button>
      </div>
      <div className="module-summary"><span><i className="status-light" />{agents.length} agents</span><span>{totalTrackedOrders} tracked orders</span></div>
      <div className="agent-list">
        <div className="agent-list-heading"><span>AGENT</span><span>COUPON</span><span>DISCOUNT</span><span>TOTAL BILL</span><span>5% AMOUNT</span><span>AGENT PAYABLE · 10%</span><span>CUSTOMERS</span><span>ORDERS</span><span>PIECES</span><span /></div>
        {agents.map((agent) => {
          const stats = statsFor(agent);
          return <div className="agent-list-row" key={agent.id}>
            <button className="agent-list-main" onClick={() => openEdit(agent)}><span className="module-row-number">{agent.name.slice(0, 2).toUpperCase()}</span><strong>{agent.name}</strong><small>{agent.phone}</small></button>
            <span className="agent-code">{agent.couponCode}</span>
            <span>{agent.discountPercent}% off</span>
            <span className="agent-money">{formatMoney(stats.billAmount)}</span>
            <span className="agent-money">{formatMoney(stats.discountAmount)}</span>
            <span className="agent-money agent-payout">{formatMoney(stats.agentPayoutAmount)}</span>
            <b>{stats.customers}</b>
            <b>{stats.orders}</b>
            <b>{stats.pieces}</b>
            <div className="product-row-actions"><button onClick={() => void toggleAgent(agent)}>{agent.status === "Active" ? "Pause" : "Activate"}</button><button onClick={() => openEdit(agent)} aria-label={`Edit ${agent.name}`} title="Edit agent"><Pencil size={15} strokeWidth={1.8} aria-hidden="true" /></button><button className="delete-action" onClick={() => void removeAgent(agent)} aria-label={`Delete ${agent.name}`} title="Delete agent"><Trash2 size={15} strokeWidth={1.8} aria-hidden="true" /></button></div>
          </div>;
        })}
        {!agents.length && <div className="agent-empty"><strong>No agents yet.</strong><span>Add an agent to create a trackable coupon code.</span><button className="module-primary" onClick={openNew}>Create first agent ↗</button></div>}
      </div>
      {formOpen && <div className="product-modal-backdrop" onClick={() => setFormOpen(false)}><div className="product-form-card product-modal-card agents-form-modal" role="dialog" aria-modal="true" aria-labelledby="agent-form-title" onClick={(event) => event.stopPropagation()}><button className="product-modal-close" aria-label="Close agent form" onClick={() => setFormOpen(false)}>×</button><p className="eyebrow">{editingId ? "EDIT AGENT" : "NEW AGENT"}</p><h3 id="agent-form-title">{editingId ? "Edit agent coupon" : "Create an agent coupon"}</h3><div className="product-form-grid"><label>Agent name<input value={form.name} onChange={(event) => { const name = event.target.value; setForm((current) => ({ ...current, name, ...(!editingId && !couponCodeTouched ? { couponCode: generateAgentCouponCode() } : {}) })); }} placeholder="e.g. Ananya" /></label><label>Phone number<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="e.g. +91 98765 43210" inputMode="tel" /></label><label>Coupon code<input value={form.couponCode} onChange={(event) => { setCouponCodeTouched(true); setForm((current) => ({ ...current, couponCode: event.target.value.toUpperCase() })); }} placeholder="FANZZY-7KQ4M2" /><button type="button" className="agent-generate-code" onClick={() => { setCouponCodeTouched(false); setForm((current) => ({ ...current, couponCode: generateAgentCouponCode() })); }}>Generate FANZZY code ↗</button></label><label>Discount percentage<input type="number" min="1" max="100" step="0.01" value={form.discountPercent} onChange={(event) => setForm((current) => ({ ...current, discountPercent: event.target.value }))} /><small className="field-help">Applied to the customer’s cart subtotal.</small></label></div><div className="product-detail-actions"><button className="module-primary" onClick={() => void saveAgent()}>Save agent</button><button className="module-secondary" onClick={() => setFormOpen(false)}>Cancel</button></div></div></div>}
    </section>
  );
}

function MarketingWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  type MarketingProductOption = { id: string; name: string; category: string };
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
    offerType: "" as "" | "bogo",
    buyQuantity: 1,
    getQuantity: 1,
    eligibleProductIds: [] as string[],
  });
  const [productOptions, setProductOptions] = useState<MarketingProductOption[]>([]);

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

  useEffect(() => {
    let active = true;
    const loadProductOptions = async () => {
      const remote = await fetchCatalogProducts();
      const remoteOptions = !remote.error && remote.data
        ? remote.data
            .filter((product) => !isDemoProduct(product))
            .map((product) => ({
              id: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              name: product.name,
              category: product.category,
            }))
        : [];
      const localOptions: MarketingProductOption[] = [];
      const stored = window.localStorage.getItem("fanzzy-products");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Array<{ id?: string; sku?: string; name?: string; category?: string }>;
          if (Array.isArray(parsed)) {
            parsed.forEach((product) => {
              if (!product.name || isDemoProduct(product)) return;
              const id = String(product.id || product.sku || product.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
              localOptions.push({ id, name: product.name, category: product.category || "Uncategorised" });
            });
          }
        } catch {
          // Ignore malformed local catalog data.
        }
      }
      if (active) {
        setProductOptions(remote.data !== null && !remote.error ? remoteOptions : localOptions);
      }
    };
    void loadProductOptions();
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
      offerType: "",
      buyQuantity: 1,
      getQuantity: 1,
      eligibleProductIds: [],
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
      offerType: record.offerType ?? "",
      buyQuantity: Math.min(3, Math.max(1, Number(record.buyQuantity) || 1)),
      getQuantity: Math.min(3, Math.max(1, Number(record.getQuantity) || 1)),
      eligibleProductIds: record.eligibleProductIds ?? [],
    });
    setFormOpen(true);
  };

  const saveRecord = async () => {
    const name = form.name.trim();
    if (!name) {
      onNotify("Add a name before saving");
      return;
    }
    if (form.kind === "Coupon" && !form.code.trim()) {
      onNotify("Add a coupon code before saving");
      return;
    }
    if (form.kind === "Coupon" && !form.discount.trim()) {
      onNotify("Add a coupon discount before saving");
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
      ...(form.offerType ? { offerType: form.offerType } : {}),
      ...(form.offerType === "bogo" ? { buyQuantity: form.buyQuantity, getQuantity: form.getQuantity } : {}),
      ...(form.offerType === "bogo" && form.eligibleProductIds.length
        ? { eligibleProductIds: form.eligibleProductIds }
        : {}),
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
              {form.kind === "Campaign" && (
                <label>
                  Offer type
                  <select
                    value={form.offerType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        offerType: event.target.value as "" | "bogo",
                        discount: event.target.value === "bogo" && !current.discount ? "Buy 1, get 1 free" : current.discount,
                      }))
                    }
                  >
                    <option value="">Standard promotion</option>
                    <option value="bogo">Buy X Get Y product offer</option>
                  </select>
                </label>
              )}
              {form.kind === "Campaign" && form.offerType === "bogo" && (
                <>
                  <label>
                    Customer buys
                    <select value={form.buyQuantity} onChange={(event) => setForm((current) => ({ ...current, buyQuantity: Number(event.target.value) }))}>
                      <option value={1}>1 product</option>
                      <option value={2}>2 products</option>
                      <option value={3}>3 products</option>
                    </select>
                  </label>
                  <label>
                    Customer gets free
                    <select value={form.getQuantity} onChange={(event) => setForm((current) => ({ ...current, getQuantity: Number(event.target.value) }))}>
                      <option value={1}>1 product</option>
                      <option value={2}>2 products</option>
                      <option value={3}>3 products</option>
                    </select>
                  </label>
                  <div className="marketing-eligible-products marketing-form-wide">
                  <span>Connect products to this offer <small>Leave none selected to include every product.</small></span>
                  <div className="marketing-product-actions"><button type="button" onClick={() => setForm((current) => ({ ...current, eligibleProductIds: productOptions.map((product) => product.id) }))}>Select all</button><button type="button" onClick={() => setForm((current) => ({ ...current, eligibleProductIds: [] }))}>All products</button></div>
                  <div className="eligible-product-list">
                    {productOptions.length ? productOptions.map((product) => (
                      <label key={product.id}>
                        <input
                          type="checkbox"
                          checked={form.eligibleProductIds.includes(product.id)}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              eligibleProductIds: event.target.checked
                                ? [...current.eligibleProductIds, product.id]
                                : current.eligibleProductIds.filter((id) => id !== product.id),
                            }))
                          }
                        />
                        <span>{product.name}<small>{product.category}</small></span>
                      </label>
                    )) : <p className="variant-empty">Add products first to target specific items.</p>}
                  </div>
                </div>
                </>
              )}
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

type PromotionCatalogOption = {
  id: string;
  sku: string;
  name: string;
  category: string;
  image: string;
  price: number;
  stock: number;
  variantType?: ProductVariantType;
  sizes: string[];
  sizeStock: Record<string, number>;
  variants: Array<{ name: string; size?: string; image?: string; stock?: number; price?: number }>;
};

function PromotionOffersWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [offers, setOffers] = useState<PromotionOffer[]>([]);
  const [catalog, setCatalog] = useState<PromotionCatalogOption[]>([]);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PromotionOffer | null>(null);
  const [form, setForm] = useState(() => defaultPromotionForm());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const saved = await fetchStoreSetting("promotionalOffers");
      const raw = saved.value || window.localStorage.getItem(promotionStorageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown[];
          const valid = Array.isArray(parsed) ? parsed.map((item) => {
            if (!item || typeof item !== "object") return null;
            const offer = item as Partial<PromotionOffer>;
            return offer.id && offer.name ? offer as PromotionOffer : null;
          }).filter((item): item is PromotionOffer => Boolean(item)) : [];
          if (alive) setOffers(valid);
        } catch { /* keep the empty workspace */ }
      }
      const [remoteCatalog, localCatalog] = await Promise.all([
        fetchCatalogProducts(),
        Promise.resolve(window.localStorage.getItem("fanzzy-products")),
      ]);
      const source = !remoteCatalog.error && remoteCatalog.data?.length ? remoteCatalog.data : (() => {
        try { return localCatalog ? JSON.parse(localCatalog) : []; } catch { return []; }
      })();
      const mapped = (Array.isArray(source) ? source : []).filter((product) => !isDemoProduct(product)).map((product) => ({
        id: String(product.sku || product.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        sku: String(product.sku || ""),
        name: String(product.name || ""),
        category: String(product.category || "Uncategorised"),
        image: String(product.image || ""),
        price: Number(product.price || 0),
        stock: Number(product.stock || 0),
        variantType: product.variantType || (Array.isArray(product.sizes) && product.sizes.length ? "size" : "normal"),
        sizes: Array.isArray(product.sizes) ? product.sizes : [],
        sizeStock: product.sizeStock && typeof product.sizeStock === "object" ? product.sizeStock : {},
        variants: Array.isArray(product.variants) && product.variants.length
          ? product.variants
          : Array.isArray(product.sizes)
            ? product.sizes.map((size: string) => ({ name: String(size), size: String(size), image: String(product.image || ""), stock: Number(product.sizeStock?.[size] ?? product.stock), price: Number(product.price || 0) }))
            : [],
      }));
      if (alive) setCatalog(mapped);
    };
    void load();
    return () => { alive = false; };
  }, []);

  const persist = async (next: PromotionOffer[], message: string) => {
    setOffers(next);
    window.localStorage.setItem(promotionStorageKey, JSON.stringify(next));
    const remoteError = await saveStoreSetting("promotionalOffers", JSON.stringify(next));
    window.dispatchEvent(new Event("fanzzy-promotions-updated"));
    onNotify(remoteError ? `${message} · saved locally` : message);
  };
  const openNew = () => {
    setEditingId(null);
    setForm(defaultPromotionForm());
    setSearch("");
    setFormOpen(true);
  };
  const openEdit = (offer: PromotionOffer) => {
    setSelected(null);
    setEditingId(offer.id);
    setForm({
      ...defaultPromotionForm(),
      ...offer,
      type: "bogo",
      buyQuantity: 1,
      freeQuantity: Math.min(4, Math.max(1, Number(offer.freeQuantity) || 1)),
      name: String(offer.name || ""),
      description: String(offer.description || ""),
      couponCode: String(offer.couponCode || ""),
      eligiblePaid: Array.isArray(offer.eligiblePaid) ? offer.eligiblePaid.slice(0, 1).map((item) => ({ ...item, variantName: undefined, size: undefined })) : [],
      eligibleFree: Array.isArray(offer.eligibleFree) ? offer.eligibleFree : [],
    });
    setSearch("");
    setFormOpen(true);
  };
  const selectedProductId = String(form.eligiblePaid[0]?.productId || "");
  const selectionForProduct = (product: PromotionCatalogOption, variant?: PromotionCatalogOption["variants"][number], size?: string): PromotionSelection => ({
    productId: product.id,
    sku: product.sku,
    variantName: product.variantType === "size" ? undefined : variant?.name,
    size: size || (product.variantType === "size" ? variant?.size || variant?.name : undefined),
    price: (variant as { price?: number } | undefined)?.price ? Number((variant as { price?: number }).price) : product.price,
    stock: size
      ? Number(product.sizeStock[size] ?? product.stock)
      : variant?.stock === undefined ? product.stock : Number(variant.stock),
  });
  const productOptions = (product: PromotionCatalogOption) => product.variantType === "size"
    ? product.sizes.length
      ? product.sizes.map((size) => selectionForProduct(product, undefined, size))
      : product.variants.map((variant) => selectionForProduct(product, variant))
    : product.variants.map((variant) => selectionForProduct(product, variant));
  const selectProduct = (product: PromotionCatalogOption) => {
    setForm((current) => {
      const alreadySelected = current.eligiblePaid[0]?.productId === product.id;
      return {
        ...current,
        type: "bogo",
        buyQuantity: 1,
        eligiblePaid: alreadySelected ? [] : [selectionForProduct(product)],
        eligibleFree: [],
      };
    });
  };
  const toggleFreeOption = (selection: PromotionSelection) => {
    setForm((current) => {
      const existing = current.eligibleFree.some((item) => JSON.stringify(item) === JSON.stringify(selection));
      return { ...current, eligibleFree: existing ? current.eligibleFree.filter((item) => JSON.stringify(item) !== JSON.stringify(selection)) : [...current.eligibleFree, selection] };
    });
  };
  const saveOffer = async () => {
    const name = String(form.name || "").trim();
    const description = String(form.description || "").trim();
    const couponCode = String(form.couponCode || "").trim().toUpperCase();
    if (!name) return onNotify("Add an offer name before saving");
    if (form.eligiblePaid.length !== 1) return onNotify("Select one product for this offer");
    if (form.freeQuantity < 1 || form.freeQuantity > 4) return onNotify("Choose between 1 and 4 free items");
    const now = new Date().toISOString();
    const offer: PromotionOffer = {
      ...form,
      type: "bogo",
      buyQuantity: 1,
      freeQuantity: Math.min(4, Math.max(1, Math.floor(Number(form.freeQuantity) || 1))),
      allowDifferentProducts: false,
      allowMixProducts: false,
      allowSameVariantMultipleTimes: true,
      maxQuantityPerVariant: 4,
      id: editingId || `offer-${Date.now()}`,
      name,
      description,
      couponCode: couponCode || undefined,
      usageCount: editingId ? (offers.find((item) => item.id === editingId)?.usageCount || 0) : 0,
      createdAt: editingId ? (offers.find((item) => item.id === editingId)?.createdAt || now) : now,
      updatedAt: now,
    };
    await persist(editingId ? offers.map((item) => item.id === editingId ? offer : item) : [offer, ...offers], editingId ? "Offer updated" : "Offer created");
    setFormOpen(false);
  };
  const deleteOffer = async (offer: PromotionOffer) => {
    if (!window.confirm(`Archive ${offer.name}? Existing orders remain linked.`)) return;
    await persist(offers.map((item) => item.id === offer.id ? { ...item, status: "Archived", updatedAt: new Date().toISOString() } : item), "Offer archived");
    setSelected(null);
  };
  const toggleOffer = async (offer: PromotionOffer) => {
    const status: PromotionOfferStatus = offer.status === "Active" ? "Inactive" : "Active";
    await persist(offers.map((item) => item.id === offer.id ? { ...item, status, updatedAt: new Date().toISOString() } : item), `${offer.name} ${status === "Active" ? "activated" : "deactivated"}`);
    setSelected((current) => current?.id === offer.id ? { ...offer, status } : current);
  };
  const visibleCatalog = catalog.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  const selectedCount = form.eligiblePaid.length ? 1 + form.eligibleFree.length : 0;

  return (
    <section className="panel module-workspace promotion-workspace">
      <div className="module-workspace-head">
        <div><p className="eyebrow">PROMOTIONS</p><h2>Buy 1 Get X Free</h2><p>Choose one product, then let customers select 1–4 free variants or sizes from that same product.</p></div>
        <div className="module-actions"><button className="module-secondary" onClick={() => onNotify("Offer report is ready from usage data")}>View report ↗</button><button className="module-primary" onClick={openNew}>+ Create offer</button></div>
      </div>
      <div className="offer-capability-strip"><span>One product per offer</span><span>Buy 1 fixed</span><span>Get 1–4 free</span><span>Variant + size aware</span></div>
      <div className="promotion-list">
        {offers.length ? offers.map((offer, index) => (
          <div className="promotion-list-row" key={offer.id}>
            <button className="promotion-list-main" onClick={() => setSelected(offer)}><span className="module-row-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{offer.name}</strong><small>{offerTypeLabel(offer)} · {offer.eligiblePaid.length + offer.eligibleFree.length || "All catalog"} eligible selections</small></span><i className={`status-pill ${offer.status.toLowerCase()}`}>{offer.status}</i><b>↗</b></button>
            <div className="product-row-actions"><button onClick={() => openEdit(offer)} aria-label={`Edit ${offer.name}`}><Pencil size={15} /></button><button className="delete-action" onClick={() => void deleteOffer(offer)} aria-label={`Archive ${offer.name}`}><Trash2 size={15} /></button></div>
          </div>
        )) : <div className="promotion-empty"><span>✦</span><h3>No promotional offers yet</h3><p>Create a Buy 1 Get 1, Buy 1 Get 2, Buy 1 Get 3, or Buy 1 Get 4 offer for one product.</p><button className="module-primary" onClick={openNew}>Create your first offer</button></div>}
      </div>
      <div className="promotion-footnote"><strong>Operational safeguards</strong><span>Offers are stored with reusable product/variant IDs. Status, dates, usage limits, and selection rules are checked before a storefront application is accepted.</span></div>

      {selected && <div className="product-modal-backdrop" onClick={() => setSelected(null)}><div className="product-detail-card promotion-detail-modal" onClick={(event) => event.stopPropagation()}><p className="eyebrow">{offerTypeLabel(selected)}</p><h3>{selected.name}</h3><p className="product-detail-meta">{selected.description || "No description added."}</p><div className="promotion-detail-grid"><span><small>Status</small><strong>{selected.status}</strong></span><span><small>Usage</small><strong>{selected.usageCount}{selected.maxTotalUsage ? ` / ${selected.maxTotalUsage}` : ""}</strong></span><span><small>Paid scope</small><strong>{selected.eligiblePaid.length || "All"}</strong></span><span><small>Free scope</small><strong>{selected.eligibleFree.length || "Same product"}</strong></span></div><p className="promotion-rules">{selected.allowMultipleQualifyingSets ? "Multiple qualifying sets enabled" : "Applies once per cart"} · {selected.allowSameVariantMultipleTimes ? "Repeat variants allowed" : "Unique variants only"} · {selected.automatic ? "Automatic" : `Coupon ${selected.couponCode || "required"}`}</p><div className="product-detail-actions"><button className="module-primary" onClick={() => openEdit(selected)}>Edit offer</button><button className="module-secondary" onClick={() => void toggleOffer(selected)}>{selected.status === "Active" ? "Deactivate" : "Activate"}</button><button className="module-secondary" onClick={() => setSelected(null)}>Close</button></div></div></div>}

      {formOpen && <div className="product-modal-backdrop" onClick={() => setFormOpen(false)}><div className="product-form-card product-modal-card promotion-form-modal" onClick={(event) => event.stopPropagation()}><button className="product-modal-close" onClick={() => setFormOpen(false)} aria-label="Close offer form">×</button><p className="eyebrow">{editingId ? "EDIT OFFER" : "NEW OFFER"}</p><h3>{editingId ? "Edit Buy 1 Get X offer" : "Build a Buy 1 Get X offer"}</h3><p className="promotion-form-intro">Select one product only. The customer buys one selected item and chooses the free variants or sizes from that same product.</p>
        <div className="promotion-form-section"><h4>Offer basics</h4><div className="product-form-grid"><label>Offer name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, type: "bogo", buyQuantity: 1, name: event.target.value }))} placeholder="e.g. Bracelet · Buy 1 Get 3" /></label><label>Offer type<span className="field-help">Buy 1 Get X Free</span></label><label className="marketing-form-wide">Offer description<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Explain what customers receive." /></label><label>Active status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as PromotionOfferStatus }))}><option>Active</option><option>Inactive</option><option>Archived</option></select></label><label>Start date/time<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label><label>End date/time<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label></div></div>
        <div className="promotion-form-section"><h4>Buy / get rules</h4><div className="product-form-grid"><label>Buy quantity<span className="field-help">1 item</span></label><label>Free quantity<select value={form.freeQuantity} onChange={(event) => setForm((current) => ({ ...current, type: "bogo", buyQuantity: 1, freeQuantity: Number(event.target.value) }))}><option value={1}>1 free</option><option value={2}>2 free</option><option value={3}>3 free</option><option value={4}>4 free</option></select></label><label>Minimum cart value<input type="number" min="0" value={form.minCartValue} onChange={(event) => setForm((current) => ({ ...current, minCartValue: Math.max(0, Number(event.target.value)) }))} /></label><label>Per-customer usage limit<input type="number" min="0" value={form.perCustomerLimit} onChange={(event) => setForm((current) => ({ ...current, perCustomerLimit: Math.max(0, Number(event.target.value)) }))} placeholder="0 = unlimited" /></label><label>Maximum total usage<input type="number" min="0" value={form.maxTotalUsage} onChange={(event) => setForm((current) => ({ ...current, maxTotalUsage: Math.max(0, Number(event.target.value)) }))} placeholder="0 = unlimited" /></label><label className="promotion-check"><input type="checkbox" checked={form.automatic} onChange={(event) => setForm((current) => ({ ...current, automatic: event.target.checked }))} /> Automatic offer</label>{!form.automatic && <label>Coupon code<input value={form.couponCode} onChange={(event) => setForm((current) => ({ ...current, couponCode: event.target.value.toUpperCase() }))} placeholder="FANZZYBOGO" /></label>}</div></div>
        <div className="promotion-form-section"><h4>Variant and size rule</h4><p className="promotion-form-intro">Only this product can qualify. Customers may mix its variants or sizes for the free items, and the same option can be used more than once when stock allows.</p></div>
        <div className="promotion-form-section"><div className="promotion-selector-header"><div><h4>Choose one product</h4><p>Variants and sizes stay inside this product. Customers choose the paid option and their free options on the product page.</p></div><strong>{selectedProductId ? "1 product selected" : "Select 1 product"}</strong></div><input className="promotion-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product or SKU…" /><div className="promotion-selector-list">{visibleCatalog.length ? visibleCatalog.map((product) => { const isSelected = product.id === selectedProductId; const options = productOptions(product); return <div className={`promotion-selector-product${isSelected ? " is-selected" : ""}`} key={product.id}><div className="promotion-product-heading"><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.sku} · {product.stock} in stock · ₹{product.price.toLocaleString("en-IN")}</small></span><button className={isSelected ? "module-secondary" : "module-secondary"} type="button" onClick={() => selectProduct(product)}>{isSelected ? "Deselect" : "Use this product"}</button></div>{isSelected && <><div className="promotion-selection-row"><span className="field-help">Buy 1: customer chooses any available variant or size.</span><span className="field-help">{form.eligibleFree.length ? `${form.eligibleFree.length} free option limit` : "All variants / sizes available free"}</span></div>{options.length ? <div className="promotion-variant-grid">{options.map((selection, index) => { const active = form.eligibleFree.some((item) => JSON.stringify(item) === JSON.stringify(selection)); const optionLabel = selection.size ? `Size ${selection.size}` : selection.variantName || `Option ${index + 1}`; return <div className="promotion-variant-option" key={JSON.stringify(selection)}><span><strong>{optionLabel}</strong><small>{selection.stock ?? product.stock} in stock · ₹{(selection.price || product.price).toLocaleString("en-IN")}</small></span><label title="Limit free item to this option"><input type="checkbox" checked={active} onChange={() => toggleFreeOption(selection)} /> Free option</label></div>; })}</div> : <p className="variant-empty">This product has no variants or sizes. The same product can be added for each free item.</p>}</>}</div>; }) : <p className="variant-empty">No products found. Add products in Products first, then return here.</p>}</div></div>
        <div className="promotion-form-actions"><button className="module-primary" onClick={() => void saveOffer()}>Save offer</button><button className="module-secondary" onClick={() => setFormOpen(false)}>Cancel</button></div>
      </div></div>}
    </section>
  );
}

function RefundRequestsWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadRequests = async () => {
      const remote = await fetchStoreSetting("refundRequests");
      const stored = remote.value || window.localStorage.getItem("fanzzy-refund-requests");
      if (!active) return;
      setRequests(parseRefundRequests(stored));
      setLoading(false);
    };
    const refresh = () => { void loadRequests().catch(() => { if (active) setLoading(false); }); };
    void loadRequests().catch(() => { if (active) setLoading(false); });
    const timer = window.setInterval(refresh, 5000);
    const unsubscribe = subscribeToStoreSetting("refundRequests", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("fanzzy-refund-requests-updated", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener("storage", refresh);
      window.removeEventListener("fanzzy-refund-requests-updated", refresh);
    };
  }, []);

  const updateStatus = async (request: RefundRequest, status: RefundRequestStatus) => {
    if (busyId) return;
    setBusyId(request.id);
    try {
      const remote = await fetchStoreSetting("refundRequests");
      const current = parseRefundRequests(remote.value || window.localStorage.getItem("fanzzy-refund-requests"));
      const next = current.map((item) => item.id === request.id
        ? { ...item, status, updatedAt: new Date().toISOString() }
        : item);
      const error = await saveStoreSetting("refundRequests", JSON.stringify(next));
      if (error) throw new Error("Refund request could not be updated.");
      window.localStorage.setItem("fanzzy-refund-requests", JSON.stringify(next));
      setRequests(next);
      window.dispatchEvent(new Event("fanzzy-refund-requests-updated"));
      onNotify(`${request.id} marked ${status.toLowerCase()}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Refund request could not be updated.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="panel module-workspace refund-requests-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">CUSTOMER CARE</p>
          <h2>Refund requests</h2>
          <p>Review refund requests from delivered orders and record the decision here.</p>
        </div>
        <div className="module-summary refund-request-summary"><span><i className="status-light" />{requests.filter((request) => request.status === "Requested").length} awaiting review</span><span>{requests.length} total request{requests.length === 1 ? "" : "s"}</span></div>
      </div>
      <div className="refund-request-notice"><strong>Manual refund step</strong><span>Approving records your decision only. Complete the actual refund in your payment provider, then mark the request as refunded.</span></div>
      {loading ? <div className="refund-request-empty">Loading refund requests…</div> : requests.length ? <div className="refund-request-list">{requests.map((request) => <article className="refund-request-card" key={request.id}><div className="refund-request-card-head"><div><strong>{request.orderId}</strong><small>{request.id} · {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(request.createdAt))}</small></div><span className={`status-pill ${request.status.toLowerCase()}`}>{request.status}</span></div><div className="refund-request-details"><div><small>Customer</small><strong>{request.customerName}</strong><span>{request.phone || "Phone not provided"}</span></div><div><small>Refund amount</small><strong>{request.amount}</strong><span>{request.reason}</span></div></div><div className="refund-request-actions">{request.status === "Requested" && <><button className="module-primary" type="button" disabled={busyId !== null} onClick={() => void updateStatus(request, "Approved")}>Approve</button><button className="module-secondary" type="button" disabled={busyId !== null} onClick={() => void updateStatus(request, "Rejected")}>Reject</button></>}{request.status === "Approved" && <button className="module-primary" type="button" disabled={busyId !== null} onClick={() => void updateStatus(request, "Refunded")}>Mark refunded</button>}{request.status === "Rejected" && <span className="refund-request-closed">No further action</span>}{request.status === "Refunded" && <span className="refund-request-closed">Refund completed</span>}</div></article>)}</div> : <div className="refund-request-empty"><strong>No refund requests yet</strong><span>Requests from delivered customer orders will appear here.</span></div>}
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
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("all");
  const [fromDate, setFromDate] = useState(() => `${reportDateKey(new Date()).slice(0, 8)}01`);
  const [toDate, setToDate] = useState(() => reportDateKey(new Date()));
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [printingBillId, setPrintingBillId] = useState<string | null>(null);
  const [enlargedOrderImage, setEnlargedOrderImage] = useState<{ src: string; alt: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [lastOrdersSync, setLastOrdersSync] = useState<Date | null>(null);
  const [ordersSyncError, setOrdersSyncError] = useState("");
  const [catalogProducts, setCatalogProducts] = useState<Array<{ id: string; name: string; sku: string; category: string; stock: number; price: number; status: string; image: string; variants: ProductVariant[] }>>([]);
  const [orderItemDraft, setOrderItemDraft] = useState({ productId: "", variantName: "", quantity: "1", price: "" });

  useEffect(() => {
    let syncInFlight = false;
    const syncOrders = async (recoverCapturedPayments = false) => {
      if (syncInFlight) return;
      syncInFlight = true;
      try {
      // Recover captured payments even when the customer's browser callback was interrupted.
      if (recoverCapturedPayments) {
        await fetch("/api/razorpay/sync-payments", { method: "POST" }).catch(() => undefined);
      }
      const localOrders: OrderRecord[] = [];
      try {
        const stored = window.localStorage.getItem("fanzzy-orders");
        const parsed = stored ? JSON.parse(stored) as OrderRecord[] : [];
        if (Array.isArray(parsed)) parsed.forEach((order) => {
          if (order?.id && !isDemoOrder(order) && hasConfirmedPayment(order)) localOrders.push(order);
        });
      } catch {
        window.localStorage.removeItem("fanzzy-orders");
      }
      // Show locally cached orders only while the first live request is loading.
      // Do not replace an already rendered list on every polling cycle.
      if (localOrders.length) setOrders((current) => current.length ? current : localOrders);
      const remote = await fetchStoreOrders<OrderRecord>();
      if (remote.error) {
        setOrdersSyncError("Live order storage is unavailable. Records may be incomplete.");
      } else {
        setOrdersSyncError("");
      }
      // The shared record is written newest-first. Keep that order as the
      // primary ordering and append only local records not yet synced.
      const merged = new Map<string, OrderRecord>();
      remote.data?.forEach((order) => { if (order?.id && !isDemoOrder(order) && hasConfirmedPayment(order)) merged.set(order.id, order); });
      localOrders.forEach((order) => { if (!merged.has(order.id)) merged.set(order.id, order); });
      const nextOrders = Array.from(merged.values());
      setOrders((current) => orderListsEqual(current, nextOrders) ? current : nextOrders);
      const [catalog, variantsRemote] = await Promise.all([fetchCatalogProducts(), fetchStoreSetting("productVariants")]);
      let variantsMap: Record<string, ProductVariant[]> = {};
      if (variantsRemote.value) {
        try {
          const parsed = JSON.parse(variantsRemote.value) as Record<string, ProductVariant[]>;
          if (parsed && typeof parsed === "object") variantsMap = parsed;
        } catch {
          variantsMap = {};
        }
      }
      if (!catalog.error && catalog.data) {
        const nextCatalogProducts = catalog.data.filter((product) => !isDemoProduct(product)).map((product) => ({
          id: product.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: product.name,
          sku: product.sku,
          category: product.category,
          stock: product.stock,
          price: product.price,
          status: product.status,
          image: product.image || adminPlaceholderImage,
          variants: Array.isArray(variantsMap[product.sku]) ? variantsMap[product.sku].map((variant, index) => ({ ...variant, name: variant.name || `Option ${index + 1}` })) : [],
        }));
        setCatalogProducts((current) => JSON.stringify(current) === JSON.stringify(nextCatalogProducts) ? current : nextCatalogProducts);
      }
      if (!remote.error) setLastOrdersSync((current) => current && Date.now() - current.getTime() < 30_000 ? current : new Date());
      } catch {
        setOrdersSyncError("Live order storage is unavailable. Records may be incomplete.");
      } finally {
        syncInFlight = false;
      }
    };
    const syncLiveOrders = () => { void syncOrders(false); };
    // Render the current orders immediately. Payment recovery is useful, but
    // it should not block the order workspace from opening.
    void syncOrders(false);
    void fetch("/api/razorpay/sync-payments", { method: "POST" })
      .then(() => syncOrders(false))
      .catch(() => undefined);
    // Realtime is the fast path; poll every two seconds as a reliable fallback
    // so a successful payment appears even if replication notifications lag.
    const liveOrderTimer = window.setInterval(syncLiveOrders, 2000);
    const unsubscribeFromLiveOrders = subscribeToStoreSetting("orders", syncLiveOrders);
    window.addEventListener("storage", syncLiveOrders);
    window.addEventListener("fanzzy-orders-updated", syncLiveOrders);
    return () => {
      window.clearInterval(liveOrderTimer);
      unsubscribeFromLiveOrders();
      window.removeEventListener("storage", syncLiveOrders);
      window.removeEventListener("fanzzy-orders-updated", syncLiveOrders);
    };
  }, []);

  const delhiveryOrderKey = useMemo(() => orders.filter((order) => order.delhiveryAwb).map((order) => `${order.id}::${order.delhiveryAwb}`).sort().join("|"), [orders]);

  useEffect(() => {
    if (!delhiveryOrderKey) return;
    let active = true;
    const orderWaybills = delhiveryOrderKey.split("|").map((value) => {
      const [id, waybill] = value.split("::");
      return { id, waybill };
    });
    const refreshTracking = async () => {
      const updates = await Promise.all(orderWaybills.map(async ({ id, waybill }) => {
        try {
          const response = await fetch("/api/delhivery/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: id, waybill }), cache: "no-store" });
          if (!response.ok) return null;
          const body = await response.json() as { tracking?: { status?: string; statusType?: string; statusDate?: string; location?: string } };
          return body.tracking ? { id, tracking: body.tracking } : null;
        } catch {
          return null;
        }
      }));
      if (!active) return;
      const byOrder = new Map(updates.filter((update): update is NonNullable<typeof update> => Boolean(update)).map((update) => [update.id, update.tracking]));
      if (!byOrder.size) return;
      const trackedAt = new Date().toISOString();
      setOrders((current) => current.map((order) => {
        const tracking = byOrder.get(order.id);
        if (!tracking) return order;
        return { ...order, delhiveryLiveStatus: tracking.status || order.delhiveryLiveStatus, delhiveryLiveStatusType: tracking.statusType || order.delhiveryLiveStatusType, delhiveryLiveStatusDate: tracking.statusDate || order.delhiveryLiveStatusDate, delhiveryLiveLocation: tracking.location || order.delhiveryLiveLocation, delhiveryLastTrackedAt: trackedAt };
      }));
    };
    void refreshTracking();
    const trackingTimer = window.setInterval(() => { void refreshTracking(); }, 60_000);
    return () => {
      active = false;
      window.clearInterval(trackingTimer);
    };
  }, [delhiveryOrderKey]);

  useEffect(() => {
    if (!selectedOrder) return;
    const refreshed = orders.find((order) => order.id === selectedOrder.id);
    if (!refreshed) return;
    const selectedTracking = [selectedOrder.delhiveryLiveStatus, selectedOrder.delhiveryLastTrackedAt].join("|");
    const refreshedTracking = [refreshed.delhiveryLiveStatus, refreshed.delhiveryLastTrackedAt].join("|");
    if (selectedTracking !== refreshedTracking) setSelectedOrder(refreshed);
  }, [orders, selectedOrder?.id]);

  const persistOrders = async (next: OrderRecord[]) => {
    setOrders(next);
    window.localStorage.setItem("fanzzy-orders", JSON.stringify(next));
    // Retain pending payments while an admin updates an order.
    const remote = await fetchStoreOrders<OrderRecord>();
    const allOrders = new Map<string, OrderRecord>();
    remote.data?.forEach((order) => { if (order?.id) allOrders.set(order.id, order); });
    next.forEach((order) => allOrders.set(order.id, order));
    await saveStoreOrders(Array.from(allOrders.values()));
  };

  const filteredOrders = useMemo(() => {
    const current = new Date();
    const latestDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    const latest = new Date(`${latestDate}T00:00:00`);
    let from = "0000-01-01";
    let to = latestDate;
    if (filter === "today") from = latestDate;
    if (filter === "this-week") {
      const weekStart = new Date(latest);
      const day = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
      from = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
    }
    if (filter === "this-month") from = latestDate.slice(0, 8) + "01";
    if (filter === "custom") {
      from = fromDate || "0000-01-01";
      to = toDate || latestDate;
    }
    if (from > to) [from, to] = [to, from];
    return orders
      .filter((order) => {
        const orderDate = String(order.date || "").slice(0, 10);
        const matchesDate = orderDate >= from && orderDate <= to;
        const matchesStatus = statusFilter === "all" || order.status === statusFilter;
        return matchesDate && matchesStatus;
      })
      // Keep a deterministic newest-first order so polling cannot reshuffle
      // same-day rows when the remote array arrives in a different order.
      .sort((left, right) => {
        const dateOrder = String(right.date || "").slice(0, 10).localeCompare(String(left.date || "").slice(0, 10));
        if (dateOrder) return dateOrder;
        const createdOrder = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
        return createdOrder || String(right.id || "").localeCompare(String(left.id || ""));
      });
  }, [orders, filter, fromDate, statusFilter, toDate]);

  const formatOrderDate = (value: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  const formatOrderTime = (value?: string) => value
    ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "";
  const openOrder = (order: OrderRecord) => {
    setSelectedOrder(order);
    setPhone(order.phone);
    setOrderItemDraft({ productId: "", variantName: "", quantity: "1", price: "" });
  };
  const getOrderedProduct = (item: NonNullable<OrderRecord["items"]>[number]) => {
    const itemName = item.name.split(" · ")[0].trim().toLowerCase();
    return catalogProducts.find((product) => product.id === item.productId || product.sku === item.productId || product.name.trim().toLowerCase() === itemName);
  };
  const draftProduct = catalogProducts.find((product) => product.id === orderItemDraft.productId);
  const addMissingOrderItem = () => {
    if (!selectedOrder || !draftProduct) return onNotify("Choose the ordered product first");
    const quantity = Math.max(1, Math.floor(Number(orderItemDraft.quantity) || 1));
    const variant = draftProduct.variants.find((candidate) => candidate.name === orderItemDraft.variantName);
    const price = orderItemDraft.price.trim() || `₹${draftProduct.price.toLocaleString("en-IN")}`;
    const item = {
      productId: draftProduct.id,
      name: `${draftProduct.name}${variant?.name ? ` · ${variant.name}` : ""}`,
      quantity,
      price,
      image: draftProduct.image,
      variantName: variant?.name,
      variantImage: variant?.image,
    };
    const updated = { ...selectedOrder, items: [...(selectedOrder.items || []), item] };
    setSelectedOrder(updated);
    void persistOrders(orders.map((order) => order.id === updated.id ? updated : order));
    setOrderItemDraft({ productId: "", variantName: "", quantity: "1", price: "" });
    onNotify(`${item.name} added to ${updated.id}`);
  };
  const restoreOrderDetailsFromRazorpay = async () => {
    if (!selectedOrder?.razorpayPaymentId) return onNotify("No Razorpay payment is linked to this order");
    try {
      const response = await fetch("/api/razorpay/restore-order-details", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ razorpayPaymentId: selectedOrder.razorpayPaymentId }),
      });
      const result = await response.json() as { error?: string; address?: string | null; phone?: string | null; email?: string | null };
      if (!response.ok) throw new Error(result.error || "Could not restore the payment details");
      const updated = {
        ...selectedOrder,
        address: result.address || selectedOrder.address,
        phone: result.phone || selectedOrder.phone,
        email: result.email || selectedOrder.email,
      };
      setSelectedOrder(updated);
      setPhone(updated.phone);
      await persistOrders(orders.map((order) => order.id === updated.id ? updated : order));
      onNotify(`Delivery details restored for ${updated.id}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not restore the payment details");
    }
  };
  const downloadBill = async (order: OrderRecord) => {
    if (printingBillId) return;
    setPrintingBillId(order.id);
    onNotify(`Opening print options for ${order.id}…`);
    try {
      const printed = await printOrderBill(order);
      onNotify(printed ? `Print window opened for bill ${order.id}` : "Printing failed: allow popups and try again");
    } catch {
      onNotify("Printing failed: allow popups and try again");
    } finally {
      setPrintingBillId(null);
    }
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
        <label className="order-status-filter">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OrderStatusFilter)}>
            <option value="all">All statuses</option>
            <option value="Processing">Processing</option>
            <option value="Packed">Packed</option>
            <option value="Shipped">Shipped</option>
            <option value="Delivered">Delivered</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <div className="module-summary">
        <span>
          <i className="status-light" />
          {filteredOrders.length} orders found
        </span>
        <span className={`orders-live-status${ordersSyncError ? " is-error" : ""}`} role={ordersSyncError ? "alert" : "status"}>
          <i className="status-light" />
          {ordersSyncError || `Live sync${lastOrdersSync ? ` · ${lastOrdersSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : " · connecting…"}`}
        </span>
        <span>
          {filter === "custom"
            ? `${fromDate || "Any date"} → ${toDate || "Any date"}`
            : filter
                .replace("this-", "This ")
                .replace("all-time", "All dates")
                .replace("today", "Today")}
        </span>
        {statusFilter !== "all" && <span>Status: {statusFilter}</span>}
      </div>
      <div className="order-list">
        {filteredOrders.map((order) => (
          <button key={order.id} onClick={() => openOrder(order)}>
            <span>
              <strong>{order.id}</strong>
              <small>{formatOrderDate(order.date)}{formatOrderTime(order.createdAt) ? ` · ${formatOrderTime(order.createdAt)}` : ""}</small>
              <small className="order-list-products">Customer ID: {order.userId || "Legacy / guest"} · {order.customerName}</small>
              <small className="order-list-products">{order.items?.map((item) => item.name).join(", ") || "No saved item details"}</small>
              <small className="order-list-products">Payment: {order.paymentMethod === "cod" ? "COD · Pay on delivery" : order.paymentStatus === "paid" ? "Paid online" : "Awaiting online payment"} · Inventory: {order.inventoryAdjusted === true ? "Updated" : "Pending"}</small>
              {order.fulfillmentMethod !== "pickup" && <small className="order-list-products">Delhivery: {order.delhiveryLiveStatus || (order.delhiveryAwb ? "Shipment created" : "Awaiting shipment")}</small>}
              {order.fulfillmentMethod !== "pickup" && order.delhiveryAwb && <small className="order-list-products">Pickup: {order.delhiveryPickupRequestStatus === "created" ? `Scheduled${order.delhiveryPickupRequestId ? ` · ${order.delhiveryPickupRequestId}` : ""}` : order.delhiveryPickupRequestStatus === "covered" ? "Covered by an existing pickup" : order.delhiveryPickupRequestStatus === "pending" ? "Request in progress" : order.delhiveryPickupRequestStatus === "failed" ? "Needs attention" : "Waiting to schedule"}</small>}
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
                {formatOrderDate(selectedOrder.date)}{formatOrderTime(selectedOrder.createdAt) ? ` · ${formatOrderTime(selectedOrder.createdAt)}` : ""} · {selectedOrder.total}
              </p>
              <p className="product-detail-meta">Payment: {selectedOrder.paymentMethod === "cod" ? `Cash on delivery${selectedOrder.codCharge ? ` · COD charge ${formatAdminCurrency(selectedOrder.codCharge)}` : ""}` : selectedOrder.paymentStatus === "paid" ? "Paid online" : "Awaiting online payment"}{selectedOrder.razorpayPaymentId ? ` · Razorpay payment ${selectedOrder.razorpayPaymentId}` : selectedOrder.razorpayOrderId ? ` · Razorpay order ${selectedOrder.razorpayOrderId}` : ""}</p>
              {selectedOrder.fulfillmentMethod !== "pickup" && <section className="admin-customer-details admin-delhivery-details"><p className="eyebrow">DELHIVERY SHIPMENT</p>{selectedOrder.delhiveryAwb ? <dl><div><dt>AWB</dt><dd>{selectedOrder.delhiveryAwb}</dd></div><div><dt>Live status</dt><dd>{selectedOrder.delhiveryLiveStatus || (selectedOrder.delhiveryShipmentStatus === "created" ? "Manifested" : "Available")}</dd></div><div><dt>Pickup request</dt><dd>{selectedOrder.delhiveryPickupRequestStatus === "created" ? `Scheduled${selectedOrder.delhiveryPickupRequestId ? ` · ${selectedOrder.delhiveryPickupRequestId}` : ""}` : selectedOrder.delhiveryPickupRequestStatus === "covered" ? "Covered by an existing pickup" : selectedOrder.delhiveryPickupRequestStatus === "pending" ? "Request in progress" : selectedOrder.delhiveryPickupRequestStatus === "failed" ? "Needs attention" : "Waiting to schedule"}{selectedOrder.delhiveryPickupRequestDate && <small>{selectedOrder.delhiveryPickupRequestDate}{selectedOrder.delhiveryPickupRequestTime ? ` · ${selectedOrder.delhiveryPickupRequestTime}` : ""}</small>}{selectedOrder.delhiveryPickupRequestError && <small>{selectedOrder.delhiveryPickupRequestError}</small>}</dd></div>{selectedOrder.delhiveryLiveLocation && <div><dt>Location</dt><dd>{selectedOrder.delhiveryLiveLocation}</dd></div>}{selectedOrder.delhiveryLastTrackedAt && <div><dt>Last checked</dt><dd>{formatOrderTime(selectedOrder.delhiveryLastTrackedAt)}</dd></div>}</dl> : <p className="product-detail-meta">{selectedOrder.delhiveryShipmentStatus === "pending" ? "Shipment creation is in progress." : selectedOrder.delhiveryShipmentStatus === "failed" ? "Shipment creation needs attention before tracking can be shown." : "Shipment will be created automatically after payment confirmation."}</p>}{selectedOrder.delhiveryAwb && <a className="module-secondary admin-delhivery-link" href={selectedOrder.delhiveryTrackingUrl || `https://www.delhivery.com/tracking?uniqueIdentifier=${encodeURIComponent(selectedOrder.delhiveryAwb)}`} target="_blank" rel="noreferrer">Open Delhivery tracking ↗</a>}</section>}
              <section className="admin-customer-details"><p className="eyebrow">CUSTOMER &amp; ORDER IDS</p><dl><div><dt>Order ID</dt><dd>{selectedOrder.id}</dd></div><div className="admin-customer-account"><dt>Customer Account ID</dt><dd>{selectedOrder.userId || "Legacy / guest order"}</dd></div><div><dt>Name</dt><dd>{selectedOrder.customerName || "Not provided"}</dd></div><div><dt>Login mobile</dt><dd>{selectedOrder.userPhone || selectedOrder.phone || "Not provided"}</dd></div><div><dt>Email</dt><dd>{selectedOrder.email || selectedOrder.userEmail || "Not provided"}</dd></div><div><dt>WhatsApp</dt><dd>{selectedOrder.phone || "Not provided"}</dd></div><div><dt>Fulfilment</dt><dd>{selectedOrder.fulfillmentMethod === "pickup" ? `Pickup from ${selectedOrder.pickupHubName || "hub"}` : "Delivery"}</dd></div><div className="admin-customer-address"><dt>{selectedOrder.fulfillmentMethod === "pickup" ? "Pickup hub / place" : "Delivery address"}</dt><dd>{selectedOrder.fulfillmentMethod === "pickup" ? `${selectedOrder.pickupHubName || "Hub"} · ${selectedOrder.pickupHubPlace || selectedOrder.address || "Place not saved"}` : selectedOrder.address || "Not provided"}</dd></div></dl>{selectedOrder.razorpayPaymentId && <button className="module-secondary admin-restore-payment-details" type="button" onClick={() => void restoreOrderDetailsFromRazorpay()}>Restore delivery details from Razorpay</button>}</section>
              {selectedOrder.items?.length ? <section className="admin-order-items"><p className="eyebrow">ITEMS IN THIS ORDER · {selectedOrder.items.length} LINES</p><div>{selectedOrder.items.map((item, itemIndex) => { const product = getOrderedProduct(item); const size = item.size || item.name.match(/(?:^| · )Size (.+)$/i)?.[1] || ""; const variant = item.variantName || (item.name.includes(" · ") ? item.name.split(" · ").slice(1).filter((part) => !/^Size /i.test(part)).join(" · ") : ""); const promotion = item.promotion; const promotionRole = promotion?.role === "free" ? "FREE ITEM" : promotion?.role === "bundle" ? "BUNDLE ITEM" : "PAID ITEM"; const selectedVariant = size ? product?.variants.find((candidate) => String(candidate.size || candidate.name).trim().replace(/^size\s+/i, "").toLowerCase() === size.trim().replace(/^size\s+/i, "").toLowerCase()) : variant ? product?.variants.find((candidate) => candidate.name.trim().toLowerCase() === variant.trim().toLowerCase()) : undefined; const selectionStock = selectedVariant?.stock ?? product?.stock; const displayImage = item.variantImage || selectedVariant?.image || item.image || product?.image; const imageAlt = variant ? `${item.name} variant` : item.name; return <article key={`${selectedOrder.id}-${item.productId || item.name}-${variant}-${size}-${promotion?.groupId || "legacy"}-${itemIndex}`}><>{displayImage ? <button className="admin-order-image-button" type="button" onClick={() => setEnlargedOrderImage({ src: displayImage, alt: imageAlt })} aria-label={`Enlarge ${imageAlt}`}><img src={displayImage} alt={imageAlt} /></button> : <span className="admin-order-item-placeholder" aria-hidden="true">✦</span>}</><span><strong>{item.name}</strong>{promotion && <small className={`admin-order-promotion ${promotion.role === "free" ? "is-free" : ""}`}>{promotionRole} · {promotion.label}</small>}{product ? <><small>{product.category} · SKU {product.sku}</small><small>Current {size ? `size ${size}` : variant ? "variant" : "product"} stock: {selectionStock} · {product.status}</small></> : <small>Product no longer in the catalog</small>}{variant && <small>Selected variant: {variant}{displayImage ? " · Variant image shown" : ""}</small>}{size && <small>Selected size: {size}</small>}{promotion && promotion.regularPrice !== promotion.linePrice && <small>Regular value: {formatAdminCurrency(promotion.regularPrice)} · Allocated price: {item.price}</small>}<em>Quantity ordered: {item.quantity}</em></span><b>{item.price}</b></article>; })}</div></section> : <section className="admin-order-items admin-order-item-repair"><p className="eyebrow">ADD MISSING ORDER DETAILS</p><p>This older paid order has no saved product information. Select the product and variant to restore its order record.</p><div className="admin-order-item-repair-fields"><label>Product<select value={orderItemDraft.productId} onChange={(event) => { const product = catalogProducts.find((candidate) => candidate.id === event.target.value); setOrderItemDraft({ productId: event.target.value, variantName: "", quantity: "1", price: product ? `₹${product.price.toLocaleString("en-IN")}` : "" }); }}><option value="">Select product</option>{catalogProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>{draftProduct?.variants.length ? <label>Variant<select value={orderItemDraft.variantName} onChange={(event) => setOrderItemDraft((current) => ({ ...current, variantName: event.target.value }))}><option value="">Select variant</option>{draftProduct.variants.map((variant, index) => <option key={`${variant.name}-${index}`} value={variant.name}>{variant.name || `Option ${index + 1}`}</option>)}</select></label> : null}<label>Quantity<input type="number" min="1" value={orderItemDraft.quantity} onChange={(event) => setOrderItemDraft((current) => ({ ...current, quantity: event.target.value }))} /></label><label>Price<input value={orderItemDraft.price} onChange={(event) => setOrderItemDraft((current) => ({ ...current, price: event.target.value }))} placeholder="₹0" /></label></div>{draftProduct && <div className="admin-order-item-repair-preview">{orderItemDraft.variantName && draftProduct.variants.find((variant) => variant.name === orderItemDraft.variantName)?.image ? <img src={draftProduct.variants.find((variant) => variant.name === orderItemDraft.variantName)?.image} alt="Selected variant preview" /> : draftProduct.image ? <img src={draftProduct.image} alt="Selected product preview" /> : null}<span>{orderItemDraft.variantName ? `Selected variant: ${orderItemDraft.variantName}` : "Select a variant if applicable"}</span></div>}<button className="module-primary" type="button" onClick={addMissingOrderItem}>Add to this order</button></section>}
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
                <button
                  className="module-secondary order-detail-bill"
                  type="button"
                  disabled={printingBillId !== null}
                  aria-busy={printingBillId === selectedOrder.id}
                  onClick={() => void downloadBill(selectedOrder)}
                >
                  {printingBillId === selectedOrder.id ? "Printing…" : "Print bill ↗"}
                </button>
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
      {enlargedOrderImage && <div className="product-modal-backdrop admin-order-image-lightbox" onClick={() => setEnlargedOrderImage(null)}><div className="admin-order-image-lightbox-card" onClick={(event) => event.stopPropagation()}><button className="product-modal-close" type="button" aria-label="Close enlarged product image" onClick={() => setEnlargedOrderImage(null)}>×</button><img src={enlargedOrderImage.src} alt={enlargedOrderImage.alt} /></div></div>}
    </section>
  );
}

function HubWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [hubs, setHubs] = useState<PickupHub[]>(defaultPickupHubs);
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadHubs = async () => {
      const remote = await fetchStoreSetting("pickupHubs");
      const remoteHubs = remote.value ? parseAdminPickupHubs(remote.value) : [];
      const localHubs = parseAdminPickupHubs(window.localStorage.getItem("fanzzy-pickup-hubs"));
      const storedHubs = remoteHubs.length ? remoteHubs : localHubs;
      if (active && storedHubs.length) setHubs(storedHubs);
    };
    void loadHubs();
    return () => {
      active = false;
    };
  }, []);

  const persistHubs = async (next: PickupHub[]) => {
    const remoteError = await saveStoreSetting("pickupHubs", JSON.stringify(next));
    window.localStorage.setItem("fanzzy-pickup-hubs", JSON.stringify(next));
    window.dispatchEvent(new Event("fanzzy-pickup-hubs-updated"));
    onNotify(remoteError ? "Hubs saved locally; Supabase needs its tables" : "Pickup hubs updated on storefront");
  };

  const saveHub = () => {
    const trimmedName = name.trim();
    const trimmedPlace = place.trim();
    if (!trimmedName || !trimmedPlace) {
      onNotify("Enter the hub name and place");
      return;
    }
    const hub: PickupHub = {
      id: editingId || `hub-${Date.now()}`,
      name: trimmedName,
      place: trimmedPlace,
    };
    const next = editingId ? hubs.map((item) => item.id === editingId ? hub : item) : [...hubs, hub];
    setHubs(next);
    setName("");
    setPlace("");
    setEditingId(null);
    void persistHubs(next);
  };

  const editHub = (hub: PickupHub) => {
    setEditingId(hub.id);
    setName(hub.name);
    setPlace(hub.place);
  };

  const removeHub = (hub: PickupHub) => {
    if (!window.confirm(`Remove ${hub.name} as a pickup hub?`)) return;
    const next = hubs.filter((item) => item.id !== hub.id);
    setHubs(next);
    if (editingId === hub.id) {
      setEditingId(null);
      setName("");
      setPlace("");
    }
    void persistHubs(next);
  };

  return (
    <section className="panel module-workspace hub-workspace">
      <div className="module-workspace-head">
        <div>
          <p className="eyebrow">ORDER FULFILMENT</p>
          <h2>Pickup hubs</h2>
          <p>Manage the locations customers can choose for free order pickup.</p>
        </div>
      </div>
      <div className="hub-form-card">
        <p className="eyebrow">{editingId ? "EDIT PICKUP HUB" : "ADD PICKUP HUB"}</p>
        <div className="hub-form">
          <label>Hub name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fanzzy Koramangala Hub" /></label>
          <label>Place / address<input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="e.g. 12th Main, Bengaluru" /></label>
          <div className="hub-form-actions">
            <button className="module-primary" type="button" onClick={saveHub}>{editingId ? "Save hub" : "Add hub"}</button>
            {editingId && <button className="module-secondary" type="button" onClick={() => { setEditingId(null); setName(""); setPlace(""); }}>Cancel</button>}
          </div>
        </div>
      </div>
      <div className="hub-list">
        {hubs.map((hub) => (
          <article className="hub-card" key={hub.id}>
            <div><p className="eyebrow">PICKUP LOCATION</p><h3>{hub.name}</h3><p>{hub.place}</p></div>
            <div className="hub-card-actions"><button className="module-secondary" type="button" onClick={() => editHub(hub)}>Edit</button><button className="module-secondary delete-action" type="button" onClick={() => removeHub(hub)}>Remove</button></div>
          </article>
        ))}
      </div>
      {!hubs.length && <div className="hub-empty">No pickup hubs added yet. Add one above to make pickup available at checkout.</div>}
      <div className="module-summary"><span><i className="status-light" />Pickup option</span><span>{hubs.length ? `${hubs.length} hub${hubs.length === 1 ? "" : "s"} available` : "Not available"}</span></div>
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
  const [freeAboveEnabled, setFreeAboveEnabled] = useState(false);
  const [freeAbove, setFreeAbove] = useState("999");

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
          freeAboveEnabled?: boolean;
          freeAbove?: number;
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
          setFreeAboveEnabled(parsed.freeAboveEnabled === true);
          setFreeAbove(String(Number.isFinite(parsed.freeAbove) ? parsed.freeAbove : 999));
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
    const nextFreeAbove = Math.max(0, Number(freeAbove) || 0);
    const value = JSON.stringify({ enabled, amount: nextAmount, freeAboveEnabled, freeAbove: nextFreeAbove });
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
      <label className="settings-check delivery-threshold-toggle">
        <input type="checkbox" checked={freeAboveEnabled} onChange={(event) => setFreeAboveEnabled(event.target.checked)} />
        <span>Free delivery above an amount</span>
        <small>Orders at or above this amount will not be charged delivery.</small>
      </label>
      {freeAboveEnabled && <label className="delivery-amount-field">
        Free delivery above (₹)
        <input type="number" min="0" value={freeAbove} onChange={(event) => setFreeAbove(event.target.value)} aria-label="Free delivery threshold" />
        <small>Example: ₹999 means ₹999 and above get free delivery.</small>
      </label>}
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

type CategorySection = "normal" | "luxury";
type AdminCategory = {
  name: string;
  pieces: number;
  image: string;
  section: CategorySection;
};

const isLuxuryProductCategory = (category: string) => /\s*·\s*lx\s*$/i.test(category.trim());
const baseProductCategory = (category: string) => category.replace(/\s*·\s*lx\s*$/i, "").trim();
const productCategorySection = (productCategory: string, categories: AdminCategory[]) => {
  if (isLuxuryProductCategory(productCategory)) return "luxury" as const;
  const categoryName = baseProductCategory(productCategory).toLowerCase();
  const matchingSections = new Set(
    categories
      .filter((category) => baseProductCategory(category.name).toLowerCase() === categoryName)
      .map((category) => category.section),
  );
  return matchingSections.size === 1 && matchingSections.has("luxury") ? "luxury" as const : "normal" as const;
};

const categorySectionDetails: Array<{
  key: CategorySection;
  label: string;
  description: string;
}> = [
  {
    key: "normal",
    label: "Normal Category",
    description: "Everyday collections and core jewellery categories.",
  },
  {
    key: "luxury",
    label: "Luxury",
    description: "Premium collections with a more elevated edit.",
  },
];

function CategoryWorkspace({
  onNotify,
}: {
  onNotify: (message: string) => void;
}) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [categoryProducts, setCategoryProducts] = useState<Array<{ category: string }> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addingSection, setAddingSection] = useState<CategorySection>("normal");
  const [name, setName] = useState("");
  const [categoryImage, setCategoryImage] = useState("");
  const [categoryFile, setCategoryFile] = useState<File | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AdminCategory | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editSection, setEditSection] = useState<CategorySection>("normal");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      const [remote, productsRemote] = await Promise.all([fetchCatalogCategories(), fetchCatalogProducts()]);
      if (active && productsRemote.data) setCategoryProducts(productsRemote.data);
      let localCategories: AdminCategory[] = [];
      const stored = window.localStorage.getItem("fanzzy-categories");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Array<Partial<AdminCategory>>;
          if (Array.isArray(parsed)) {
            localCategories = parsed
              .filter((category) => typeof category.name === "string" && category.name.trim())
              .map((category) => ({
                name: category.name!.trim(),
                pieces: Number(category.pieces) || 0,
                section: category.section === "luxury" ? "luxury" : "normal",
                image: category.image || "",
              }));
          }
        } catch {
          window.localStorage.removeItem("fanzzy-categories");
        }
      }
      if (active && !remote.error && remote.data) {
        const categoryIdentity = (name: string, section: CategorySection = "normal") => `${name.trim()}::${section}`;
        const localCategoryByIdentity = new Map(localCategories.map((category) => [categoryIdentity(category.name, category.section), category]));
        const localCategoryByExactName = new Map<string, AdminCategory | null>();
        localCategories.forEach((category) => {
          const key = category.name.trim();
          const previous = localCategoryByExactName.get(key);
          localCategoryByExactName.set(key, previous && previous.section !== category.section ? null : category);
        });
        const mapped = remote.data.map((category) => ({
          name: category.name,
          pieces: category.pieces,
          section: localCategoryByIdentity.get(categoryIdentity(category.name, category.section || "normal"))?.section || localCategoryByExactName.get(category.name.trim())?.section || category.section || "normal",
          image:
            category.image ||
            defaultCategoryImages[category.name] ||
            "",
        }));
        const remoteIdentities = new Set(mapped.map((category) => categoryIdentity(category.name, category.section)));
        const nextCategories = inferLegacyCategorySections([...mapped, ...localCategories.filter((category) => !remoteIdentities.has(categoryIdentity(category.name, category.section)))]);
        setCategories(nextCategories);
        persistCategories(nextCategories);
        return;
      }
      if (active && localCategories.length) setCategories(localCategories);
    };
    void loadCategories();
    return () => {
      active = false;
      };
  }, []);
  const getCategoryPieceCount = (category: AdminCategory) => {
    if (!categoryProducts) return category.pieces;
    return categoryProducts.filter((product) =>
      baseProductCategory(product.category).toLowerCase() === baseProductCategory(category.name).toLowerCase() &&
      productCategorySection(product.category, categories) === category.section,
    ).length;
  };
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
    const category: AdminCategory = {
      name: name.trim(),
      pieces: 0,
      image: nextImage,
      section: addingSection,
    };
    const remoteError = await saveCatalogCategory(category);
    const nextCategories = [...categories, category];
    setCategories(nextCategories);
    persistCategories(nextCategories);
    setName("");
    setCategoryImage("");
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
  const openCategory = (category: AdminCategory) => {
    setSelectedCategory(category);
    setIsEditing(false);
    onNotify(`${category.name} category selected`);
  };
  const startEditingCategory = (category: AdminCategory) => {
    setSelectedCategory(category);
    setEditName(category.name);
    setEditImage(
      category.image ||
        defaultCategoryImages[category.name] ||
        "",
    );
    setEditSection(category.section || "normal");
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
      section: editSection,
    };
    const remoteError = await renameCatalogCategory(
      selectedCategory.name,
      updatedCategory,
    );
    const nextCategories = categories.map((category) =>
      category.name === selectedCategory.name ? updatedCategory : category,
    );
    setCategories(nextCategories);
    persistCategories(nextCategories);
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
  const deleteCategory = async (category: AdminCategory) => {
    if (!window.confirm(`Delete ${category.name}?`)) return;
    const remoteError = await removeCatalogCategory(category.name);
    const nextCategories = categories.filter((item) => item.name !== category.name);
    setCategories(nextCategories);
    persistCategories(nextCategories);
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
              <label>
                Category section
                <select
                  value={addingSection}
                  onChange={(event) => setAddingSection(event.target.value as CategorySection)}
                >
                  {categorySectionDetails.map((section) => (
                    <option key={section.key} value={section.key}>{section.label}</option>
                  ))}
                </select>
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
      <div className="category-sections">
        {categorySectionDetails.map((section) => {
          const sectionCategories = categories.filter((category) => category.section === section.key && !(section.key === "luxury" && category.name.trim().toLowerCase() === "rings"));
          return (
            <section className="category-section" key={section.key} aria-labelledby={`${section.key}-categories-title`}>
              <div className="category-section-heading">
                <div>
                  <p className="eyebrow">{section.key === "normal" ? "CORE COLLECTION" : "PREMIUM COLLECTION"}</p>
                  <h3 id={`${section.key}-categories-title`}>{section.label}</h3>
                  <p>{section.description}</p>
                </div>
                <button
                  className="module-primary"
                  onClick={() => {
                    setAddingSection(section.key);
                    setIsAdding(true);
                  }}
                >
                  + Add category
                </button>
              </div>
              <div className="module-list">
                {sectionCategories.map((category, index) => (
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
                      <small>{getCategoryPieceCount(category)} pieces</small>
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
                {!sectionCategories.length && <p className="category-section-empty">No categories yet. Add the first one to this section.</p>}
              </div>
            </section>
          );
        })}
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
                ""
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
            <label>
              Category section
              <select
                value={editSection}
                onChange={(event) => setEditSection(event.target.value as CategorySection)}
              >
                {categorySectionDetails.map((section) => (
                  <option key={section.key} value={section.key}>{section.label}</option>
                ))}
              </select>
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
                ""
              }
              alt={`${selectedCategory.name} category card`}
            />
          </div>
          <div className="product-detail-copy">
            <p className="eyebrow">CATEGORY DETAILS</p>
            <h3>{selectedCategory.name}</h3>
            <p className="product-detail-meta">{selectedCategory.section === "luxury" ? "Luxury category" : "Normal category"}</p>
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
  productScannerRequest = 0,
  scannerOnly = false,
}: {
  onNotify: (message: string) => void;
  productScannerRequest?: number;
  scannerOnly?: boolean;
}) {
  const [products, setProducts] = useState(adminProducts);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [promotionOffers, setPromotionOffers] = useState<PromotionOffer[]>([]);
  const [productDamages, setProductDamages] = useState<ProductDamageMap>({});
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(
    null,
  );
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [damageFormOpen, setDamageFormOpen] = useState(false);
  const [damageSaving, setDamageSaving] = useState(false);
  const [damageQuantity, setDamageQuantity] = useState("1");
  const [damageReason, setDamageReason] = useState("");
  const [damageVariantKey, setDamageVariantKey] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [productVariantFilter, setProductVariantFilter] = useState("all");
  const [productSupplierFilter, setProductSupplierFilter] = useState("all");
  const [catalogCategories, setCatalogCategories] = useState<Array<{ name: string; pieces: number; image?: string; section?: CategorySection }>>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editValues, setEditValues] = useState({
    name: "",
    category: "",
    price: "",
    cost: "",
    stock: "",
    sku: "",
    image: "",
    hoverImage: "",
    barcode: "",
    hsnCode: "",
    billName: "",
    supplierName: "",
    markup: "",
    gstRate: "",
    costWithGst: "₹",
    sizes: "",
    sizeStock: {} as Record<string, number | "">,
    variants: [] as ProductVariant[],
    variantType: "normal" as ProductVariantType,
  });
  const [newProductImage, setNewProductImage] = useState(
    adminPlaceholderImage,
  );
  const [newProductFile, setNewProductFile] = useState<File | null>(null);
  const [newProductHoverImage, setNewProductHoverImage] = useState(
    adminPlaceholderImage,
  );
  const [newProductHoverFile, setNewProductHoverFile] = useState<File | null>(
    null,
  );
  const [newImageAdjustments, setNewImageAdjustments] = useState<ImageAdjustments>(defaultImageAdjustments);
  const [newHoverAdjustments, setNewHoverAdjustments] = useState<ImageAdjustments>(defaultImageAdjustments);
  const [newImageAdjustmentsEnabled, setNewImageAdjustmentsEnabled] = useState(false);
  const [newHoverAdjustmentsEnabled, setNewHoverAdjustmentsEnabled] = useState(false);
  const [newVariantAdjustmentsEnabled, setNewVariantAdjustmentsEnabled] = useState(false);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editHoverFile, setEditHoverFile] = useState<File | null>(null);
  const [editImageAdjustments, setEditImageAdjustments] = useState<ImageAdjustments>(defaultImageAdjustments);
  const [editHoverAdjustments, setEditHoverAdjustments] = useState<ImageAdjustments>(defaultImageAdjustments);
  const [editImageAdjustmentsEnabled, setEditImageAdjustmentsEnabled] = useState(false);
  const [editHoverAdjustmentsEnabled, setEditHoverAdjustmentsEnabled] = useState(false);
  const [editVariantAdjustmentsEnabled, setEditVariantAdjustmentsEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProductImageInputRef = useRef<HTMLInputElement>(null);
  const newProductHoverImageInputRef = useRef<HTMLInputElement>(null);
  const editProductImageInputRef = useRef<HTMLInputElement>(null);
  const editProductHoverImageInputRef = useRef<HTMLInputElement>(null);
  const newVariantImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const editVariantImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [newProduct, setNewProduct] = useState({
    name: "",
    category: "Earrings",
    price: "₹",
    cost: "₹",
    stock: "",
    sku: "",
    barcode: "",
    hsnCode: "",
    billName: "",
    supplierName: "",
    markup: "",
    gstRate: "",
    costWithGst: "₹",
    sizes: "",
    sizeStock: {} as Record<string, number | "">,
    variants: [] as ProductVariant[],
    variantType: "normal" as ProductVariantType,
  });
  useEffect(() => {
    if (productScannerRequest > 0) setScannerOpen(true);
  }, [productScannerRequest]);
  useEffect(() => {
    let active = true;
    const loadSuppliers = async () => {
      const remote = await fetchStoreSetting("suppliers");
      const stored = remote.value || window.localStorage.getItem(localSuppliersKey);
      const parsedSuppliers = parseSupplierRecords(stored);
      const ensured = ensurePreferredSupplier(parsedSuppliers);
      const next = ensured.suppliers;
      if (!active) return;
      setSuppliers(next);
      const defaultSupplierName = next.find((supplier) => supplier.isDefault)?.name || "";
      if (defaultSupplierName) {
        setNewProduct((current) => current.supplierName ? current : { ...current, supplierName: defaultSupplierName });
      }
      if (remote.value || ensured.changed) {
        if (ensured.changed) await saveStoreSetting("suppliers", JSON.stringify(next));
        persistSuppliers(next);
      }
    };
    const syncSuppliers = () => {
      const next = ensurePreferredSupplier(parseSupplierRecords(window.localStorage.getItem(localSuppliersKey))).suppliers;
      setSuppliers(next);
      const defaultSupplierName = next.find((supplier) => supplier.isDefault)?.name || "";
      if (defaultSupplierName) setNewProduct((current) => current.supplierName ? current : { ...current, supplierName: defaultSupplierName });
    };
    void loadSuppliers();
    window.addEventListener("fanzzy-suppliers-updated", syncSuppliers);
    window.addEventListener("storage", syncSuppliers);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-suppliers-updated", syncSuppliers);
      window.removeEventListener("storage", syncSuppliers);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const readLocalCategories = () => {
      const stored = window.localStorage.getItem("fanzzy-categories");
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Array<{ name?: string; pieces?: number; image?: string; section?: CategorySection }>;
        if (active && Array.isArray(parsed)) {
          setCatalogCategories(
            parsed
              .filter((category) => typeof category.name === "string" && category.name.trim())
              .map((category) => ({
                name: category.name!.trim(),
                pieces: Number(category.pieces) || 0,
                image: category.image || "",
                section: category.section || "normal",
              })),
          );
        }
      } catch {
        window.localStorage.removeItem("fanzzy-categories");
      }
    };
    const loadCategories = async () => {
      const remote = await fetchCatalogCategories();
      if (!active) return;
      if (!remote.error && remote.data) {
        const stored = window.localStorage.getItem("fanzzy-categories");
        let localCategories: Array<{ name: string; pieces: number; image?: string; section?: CategorySection }> = [];
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as Array<{ name?: string; pieces?: number; image?: string; section?: CategorySection }>;
            if (Array.isArray(parsed)) {
              localCategories = parsed
                .filter((category) => typeof category.name === "string" && category.name.trim())
                .map((category) => ({
                  name: category.name!.trim(),
                  pieces: Number(category.pieces) || 0,
                  image: category.image || "",
                  section: category.section === "luxury" ? "luxury" : "normal",
                }));
            }
          } catch {
            window.localStorage.removeItem("fanzzy-categories");
          }
        }
        const categoryIdentity = (name: string, section: CategorySection = "normal") => `${name.trim()}::${section}`;
        const localCategoryByIdentity = new Map(localCategories.map((category) => [categoryIdentity(category.name, category.section), category]));
        const localCategoryByExactName = new Map<string, { name: string; pieces: number; image?: string; section?: CategorySection } | null>();
        localCategories.forEach((category) => {
          const key = category.name.trim();
          const previous = localCategoryByExactName.get(key);
          localCategoryByExactName.set(key, previous && previous.section !== category.section ? null : category);
        });
        const mapped = remote.data.map((category) => ({
          name: category.name,
          pieces: category.pieces,
          image: category.image || "",
          section: localCategoryByIdentity.get(categoryIdentity(category.name, category.section || "normal"))?.section || localCategoryByExactName.get(category.name.trim())?.section || category.section || "normal",
        }));
        const remoteIdentities = new Set(mapped.map((category) => categoryIdentity(category.name, category.section)));
        const nextCategories = inferLegacyCategorySections([
          ...mapped,
          ...localCategories.filter((category) => !remoteIdentities.has(categoryIdentity(category.name, category.section))),
        ]);
        setCatalogCategories(nextCategories);
        persistCategories(nextCategories);
        return;
      }
      readLocalCategories();
    };
    const syncCategories = () => readLocalCategories();
    void loadCategories();
    window.addEventListener("fanzzy-categories-updated", syncCategories);
    window.addEventListener("storage", syncCategories);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-categories-updated", syncCategories);
      window.removeEventListener("storage", syncCategories);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const loadDamages = async () => {
      const remote = await fetchStoreSetting("productDamages");
      const stored = remote.value || window.localStorage.getItem(localProductDamagesKey);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as ProductDamageMap;
        if (active && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setProductDamages(parsed);
          persistProductDamages(parsed);
        }
      } catch {
        if (active) setProductDamages({});
      }
    };
    void loadDamages();
    const syncDamages = () => {
      const stored = window.localStorage.getItem(localProductDamagesKey);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as ProductDamageMap;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setProductDamages(parsed);
      } catch {
        // Ignore malformed local damage history.
      }
    };
    window.addEventListener("fanzzy-product-damages-updated", syncDamages);
    window.addEventListener("storage", syncDamages);
    return () => {
      active = false;
      window.removeEventListener("fanzzy-product-damages-updated", syncDamages);
      window.removeEventListener("storage", syncDamages);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const loadProducts = async () => {
      const [
        remote,
        barcodeRemote,
        hsnCodeRemote,
        billNameRemote,
        supplierNameRemote,
        pricingRemote,
        variantsRemote,
        variantTypeRemote,
        sizesRemote,
        sizeStockRemote,
        imageAdjustmentsRemote,
        promotionalOffersRemote,
      ] = await Promise.all([
        fetchCatalogProducts(),
        fetchStoreSetting("productBarcodes"),
        fetchStoreSetting("productHsnCodes"),
        fetchStoreSetting("productBillNames"),
        fetchStoreSetting("productSupplierNames"),
        fetchStoreSetting("productPricing"),
        fetchStoreSetting("productVariants"),
        fetchStoreSetting("productVariantType"),
        fetchStoreSetting("productSizes"),
        fetchStoreSetting("productSizeStock"),
        fetchStoreSetting("productImageAdjustments"),
        fetchStoreSetting("promotionalOffers"),
      ]);
      const storedPromotionalOffers = promotionalOffersRemote.value || window.localStorage.getItem(promotionStorageKey);
      if (storedPromotionalOffers) {
        try {
          const parsed = JSON.parse(storedPromotionalOffers) as unknown[];
          if (Array.isArray(parsed)) setPromotionOffers(parsed.flatMap((value) => { const offer = normalizePromotionOffer(value); return offer ? [offer] : []; }));
        } catch {
          setPromotionOffers([]);
        }
      }
      let barcodeMap: Record<string, string> = {};
      let hsnCodeMap: Record<string, string> = {};
      let billNameMap: Record<string, string> = {};
      let supplierNameMap: Record<string, string> = {};
      let pricingMap: Record<string, { gstRate?: number; markup?: number }> = {};
      let variantsMap: Record<string, ProductVariant[]> = {};
      let variantTypeMap: Record<string, ProductVariantType> = {};
      let sizesMap: Record<string, string[]> = {};
      let sizeStockMap: Record<string, Record<string, number>> = {};
      let imageAdjustmentsMap: Record<string, ProductImageAdjustments> = {};
      if (barcodeRemote.value) {
        try {
          const parsed = JSON.parse(barcodeRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            barcodeMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            );
          }
        } catch {
          barcodeMap = {};
        }
      }
      if (hsnCodeRemote.value) {
        try {
          const parsed = JSON.parse(hsnCodeRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            hsnCodeMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            );
          }
        } catch {
          hsnCodeMap = {};
        }
      }
      if (billNameRemote.value) {
        try {
          const parsed = JSON.parse(billNameRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            billNameMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            );
          }
        } catch {
          billNameMap = {};
        }
      }
      if (supplierNameRemote.value) {
        try {
          const parsed = JSON.parse(supplierNameRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            supplierNameMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            );
          }
        } catch {
          supplierNameMap = {};
        }
      }
      const shouldBackfillSupplierNames = Object.keys(supplierNameMap).length === 0;
      if (pricingRemote.value) {
        try {
          const parsed = JSON.parse(pricingRemote.value) as Record<string, { gstRate?: number; markup?: number }>;
          if (parsed && typeof parsed === "object") pricingMap = parsed;
        } catch {
          pricingMap = {};
        }
      }
      if (variantsRemote.value) {
        try {
          const parsed = JSON.parse(variantsRemote.value) as Record<string, ProductVariant[]>;
          if (parsed && typeof parsed === "object") variantsMap = parsed;
        } catch {
          variantsMap = {};
        }
      }
      if (variantTypeRemote.value) {
        try {
          const parsed = JSON.parse(variantTypeRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            variantTypeMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, ProductVariantType] => entry[1] === "normal" || entry[1] === "size"),
            );
          }
        } catch {
          variantTypeMap = {};
        }
      }
      if (sizesRemote.value) {
        try {
          const parsed = JSON.parse(sizesRemote.value) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            sizesMap = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((size) => typeof size === "string")),
            );
          }
        } catch {
          sizesMap = {};
        }
      }
      if (sizeStockRemote.value) {
        try {
          const parsed = JSON.parse(sizeStockRemote.value) as Record<string, Record<string, number>>;
          if (parsed && typeof parsed === "object") sizeStockMap = parsed;
        } catch { sizeStockMap = {}; }
      }
      if (imageAdjustmentsRemote.value) {
        try {
          const parsed = JSON.parse(imageAdjustmentsRemote.value) as Record<string, ProductImageAdjustments>;
          if (parsed && typeof parsed === "object") imageAdjustmentsMap = parsed;
        } catch {
          imageAdjustmentsMap = {};
        }
      }
      const localVariantsMap: Record<string, ProductVariant[]> = {};
      const localSizesMap: Record<string, string[]> = {};
      const storedVariantCache = window.localStorage.getItem(localProductVariantsKey);
      if (storedVariantCache) {
        try {
          const parsed = JSON.parse(storedVariantCache) as Record<string, ProductVariant[]>;
          if (parsed && typeof parsed === "object") {
            Object.entries(parsed).forEach(([key, variants]) => {
              if (Array.isArray(variants) && variants.length) localVariantsMap[key] = variants;
            });
          }
        } catch {
          // Ignore malformed local variant cache.
        }
      }
      const storedCatalog = window.localStorage.getItem("fanzzy-products");
      if (storedCatalog) {
        try {
          const parsed = JSON.parse(storedCatalog) as Array<{ sku?: string; variants?: ProductVariant[]; sizes?: string[] }>;
          if (Array.isArray(parsed)) {
            parsed.forEach((product) => {
              if (product.sku && product.variants?.length) localVariantsMap[product.sku] = product.variants;
              if (product.sku && product.sizes?.length) localSizesMap[product.sku] = product.sizes;
            });
          }
        } catch {
          // Ignore malformed local catalog data.
        }
      }
      if (active && !remote.error && remote.data !== null) {
        const mapped: AdminProduct[] = remote.data.filter((product) => !isDemoProduct(product)).map((product) => {
          const savedAdjustments = imageAdjustmentsMap[product.sku];
          const variants = variantsMap[product.sku]?.length ? variantsMap[product.sku] : localVariantsMap[product.sku] || [];
          const sizes = sizesMap[product.sku]?.length
            ? sizesMap[product.sku]
            : localSizesMap[product.sku]?.length
              ? localSizesMap[product.sku]
              : Array.from(new Set(variants.map((variant) => variant.size).filter((size): size is string => Boolean(size))));
          const savedSizeStock = sizeStockMap[product.sku] || {};
          const sizeStock = Object.keys(savedSizeStock).length
            ? savedSizeStock
            : Object.fromEntries(variants.filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!]));
          return {
          name: product.name,
          price: normalizeWholeSellingPrice(product.price),
           cost: `₹${(product.cost ?? 0).toLocaleString("en-IN")}`,
           compareAt: product.compareAt,
          sku: product.sku,
          category: product.category,
          stock: product.stock,
          status: product.status,
          image: product.image || adminPlaceholderImage,
          hoverImage:
            product.hoverImage || product.image || adminPlaceholderImage,
          barcode: barcodeMap[product.sku] || product.barcode || "",
          hsnCode: hsnCodeMap[product.sku] || "",
          billName: billNameMap[product.sku] || "",
          supplierName: supplierNameMap[product.sku] || (shouldBackfillSupplierNames ? preferredDefaultSupplierName : ""),
          gstRate: pricingMap[product.sku]?.gstRate || 0,
          markup: pricingMap[product.sku]?.markup || 0,
          costWithGst: calculatePricing(`₹${(product.cost ?? 0).toLocaleString("en-IN")}`, String(pricingMap[product.sku]?.gstRate || 0), String(pricingMap[product.sku]?.markup || 0)).costWithGst,
           sizes,
           sizeStock,
           variantType: variantTypeMap[product.sku] || (sizes.length ? "size" : "normal"),
           variants: variants.map((variant, index) => ({
            ...variant,
            adjustments: normalizeImageAdjustments(savedAdjustments?.variants?.[index] || variant.adjustments),
          })),
          imageAdjustments: normalizeImageAdjustments(savedAdjustments?.image),
          hoverImageAdjustments: normalizeImageAdjustments(savedAdjustments?.hoverImage),
        };
        });
        // Supabase is the shared catalog. Never merge stale local records back
        // into it, otherwise a product deleted on one device can be resurrected
        // by an older localStorage snapshot on another device.
        setProducts(mapped);
        persistCatalog(mapped);
        if (shouldBackfillSupplierNames && mapped.length) void saveProductSupplierNames(mapped);
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
          const mapped = parsed
              .filter(
                (product) =>
                  typeof product.name === "string" && product.name.trim() && !isDemoProduct(product),
              )
              .map((product, index) => {
                const rawPrice = product.price as number | string | undefined;
                const rawCost = product.cost as number | string | undefined;
                const sku =
                  product.sku ||
                  product.id?.toUpperCase() ||
                  `FZ-IMP-${String(index + 1).padStart(2, "0")}`;
                const localVariants = product.variants?.length ? product.variants : variantsMap[sku]?.length ? variantsMap[sku] : localVariantsMap[sku] || [];
                const localSizes = product.sizes?.length ? product.sizes : sizesMap[sku]?.length ? sizesMap[sku] : localSizesMap[sku] || Array.from(new Set(localVariants.map((variant) => variant.size).filter((size): size is string => Boolean(size))));
                const localSizeStock = product.sizeStock || sizeStockMap[sku] || Object.fromEntries(localVariants.filter((variant) => variant.size && variant.stock !== undefined).map((variant) => [variant.size!, variant.stock!]));
                return {
                  name: product.name!.trim(),
                  price: normalizeWholeSellingPrice(rawPrice ?? "₹0"),
                  cost:
                    typeof rawCost === "number"
                      ? `₹${rawCost.toLocaleString("en-IN")}`
                      : rawCost || "₹0",
                  compareAt: typeof product.compareAt === "number" ? product.compareAt : undefined,
                  sku,
                  category: product.category || "Uncategorised",
                  stock: product.stock ?? 0,
                  status: product.status ?? "Published",
                  image: product.image || adminPlaceholderImage,
                  hoverImage:
                    product.hoverImage ||
                    product.image ||
                    adminPlaceholderImage,
                  barcode: product.barcode || barcodeMap[sku] || "",
                  hsnCode: product.hsnCode || hsnCodeMap[sku] || "",
                  billName: product.billName || billNameMap[sku] || "",
                  supplierName: product.supplierName || supplierNameMap[sku] || (shouldBackfillSupplierNames ? preferredDefaultSupplierName : ""),
                  gstRate: product.gstRate ?? pricingMap[sku]?.gstRate ?? 0,
                  markup: product.markup ?? pricingMap[sku]?.markup ?? 0,
                  costWithGst: product.costWithGst || calculatePricing(String(rawCost ?? "₹0"), String(product.gstRate ?? pricingMap[sku]?.gstRate ?? 0), String(product.markup ?? pricingMap[sku]?.markup ?? 0)).costWithGst,
           sizes: localSizes,
           sizeStock: localSizeStock,
           variantType: product.variantType || variantTypeMap[sku] || (localSizes.length ? "size" : "normal"),
           variants: localVariants,
                };
              });
          setProducts(mapped);
          persistCatalog(mapped);
          if (shouldBackfillSupplierNames && mapped.length) void saveProductSupplierNames(mapped);
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
  const productCategories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [products],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set([
      ...catalogCategories.map((category) => category.name.trim()),
      ...productCategories,
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [catalogCategories, productCategories],
  );
  const productSuppliers = useMemo(
    () => Array.from(new Set([
      ...suppliers.map((supplier) => supplier.name),
      ...products.map((product) => product.supplierName || ""),
    ].map((name) => name.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [products, suppliers],
  );
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return products.filter((product) => {
      const variants = product.variants || [];
      const matchesSearch = !query || [
        product.name,
        product.sku,
        product.barcode,
        product.category,
        ...(product.sizes || []),
        ...variants.map((variant) => variant.name),
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesCategory = productCategoryFilter === "all" || product.category.trim().toLowerCase() === productCategoryFilter.trim().toLowerCase();
      const matchesVariant = productVariantFilter === "all"
        || (productVariantFilter === "with-variants" && variants.length > 0);
      const matchesSupplier = productSupplierFilter === "all"
        || product.supplierName?.trim().toLowerCase() === productSupplierFilter.trim().toLowerCase();
      return matchesSearch && matchesCategory && matchesVariant && matchesSupplier;
    });
  }, [productCategoryFilter, productSearch, productSupplierFilter, productVariantFilter, products]);
  const damageOptions = useMemo(() => {
    if (!selectedProduct) return [];
    const variants = selectedProduct.variants || [];
    if (variants.length) {
      return variants.map((variant, index) => {
        const label = selectedProduct.variantType === "size"
          ? (variant.size || variant.name || `Size ${index + 1}`)
          : (variant.name || `Option ${index + 1}`);
        const stock = selectedProduct.variantType === "size"
          ? Number(variant.stock ?? selectedProduct.sizeStock?.[label] ?? 0)
          : Number(variant.stock || 0);
        return { key: `variant:${index}`, label, stock, index };
      });
    }
    if (selectedProduct.variantType === "size" && selectedProduct.sizes?.length) {
      return selectedProduct.sizes.map((size) => ({
        key: `size:${size}`,
        label: `Size ${size}`,
        stock: Number(selectedProduct.sizeStock?.[size] || 0),
        size,
      }));
    }
    return [];
  }, [selectedProduct]);
  const selectedLiveStock = useMemo(() => {
    if (!selectedProduct) return 0;
    if (damageOptions.length) return damageOptions.reduce((total, option) => total + Math.max(0, option.stock), 0);
    return Math.max(0, Number(selectedProduct.stock) || 0);
  }, [damageOptions, selectedProduct]);
  const updateField = (field: keyof typeof newProduct, value: string) =>
    setNewProduct((current) => {
      const next = {
        ...current,
        [field]: value,
        ...(field === "name"
          ? { sku: createSku(value, current.category, products) }
          : {}),
      };
      if (field === "cost" || field === "gstRate" || field === "markup") {
        const pricing = calculatePricing(next.cost, next.gstRate, next.markup);
        next.costWithGst = pricing.costWithGst;
        if (parseMoney(next.cost) > 0) next.price = pricing.price;
      }
      if (field === "price") next.markup = calculateMarkupFromSellingPrice(next.cost, next.gstRate, next.price);
      return next;
    });
  const openDamageForm = (product: AdminProduct) => {
    setSelectedProduct(product);
    setIsAdding(false);
    setIsEditing(false);
    setDamageQuantity("1");
    setDamageReason("");
    setDamageVariantKey("");
    setDamageFormOpen(true);
  };
  const saveDamage = async () => {
    if (!selectedProduct || damageSaving) return;
    setDamageSaving(true);
    const quantity = Math.floor(Number(damageQuantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      setDamageSaving(false);
      return onNotify("Enter a valid damaged quantity");
    }
    if (!damageReason.trim()) {
      setDamageSaving(false);
      return onNotify("Add a reason for the damaged stock");
    }

    try {
      const variants = (selectedProduct.variants || []).map((variant) => ({ ...variant }));
      const sizeStock = { ...(selectedProduct.sizeStock || {}) };
      let availableStock = Number(selectedProduct.stock) || 0;
      let stockScope = "Product stock";
      if (damageVariantKey.startsWith("variant:")) {
        const index = Number(damageVariantKey.split(":")[1]);
        const variant = variants[index];
        if (!variant) return onNotify("Select a valid variant or size");
        const label = selectedProduct.variantType === "size"
          ? (variant.size || variant.name || `Size ${index + 1}`)
          : (variant.name || `Option ${index + 1}`);
        availableStock = selectedProduct.variantType === "size"
          ? Number(variant.stock ?? sizeStock[label] ?? 0)
          : Number(variant.stock || 0);
        stockScope = label;
        if (quantity > availableStock) return onNotify(`Only ${availableStock} units available for ${label}`);
        variant.stock = availableStock - quantity;
        if (selectedProduct.variantType === "size") sizeStock[label] = availableStock - quantity;
      } else if (damageVariantKey.startsWith("size:")) {
        const size = damageVariantKey.slice(5);
        availableStock = Number(sizeStock[size] || 0);
        stockScope = `Size ${size}`;
        if (quantity > availableStock) return onNotify(`Only ${availableStock} units available for Size ${size}`);
        sizeStock[size] = availableStock - quantity;
      } else {
        if (damageOptions.length) return onNotify("Select the variant or size that was damaged");
        if (quantity > availableStock) return onNotify(`Only ${availableStock} units available`);
      }
      const liveStock = variants.length
        ? variants.reduce((total, variant) => total + Math.max(0, Number(variant.stock) || 0), 0)
        : selectedProduct.variantType === "size" && selectedProduct.sizes?.length
          ? selectedProduct.sizes.reduce((total, size) => total + Math.max(0, Number(sizeStock[size]) || 0), 0)
          : Math.max(0, availableStock - quantity);
      const updated: AdminProduct = {
        ...selectedProduct,
        stock: liveStock,
        sizeStock,
        variants,
        status: liveStock > 0 ? "Published" : "Draft",
      };
      const nextProducts = products.map((product) => product.sku === selectedProduct.sku ? updated : product);
      const nextRecord: ProductDamageRecord = {
        id: `damage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sku: selectedProduct.sku,
        productName: selectedProduct.name,
        quantity,
        reason: damageReason.trim(),
        stockScope,
        createdAt: new Date().toISOString(),
      };
      const nextDamages: ProductDamageMap = {
        ...productDamages,
        [selectedProduct.sku]: [...(productDamages[selectedProduct.sku] || []), nextRecord],
      };
      let remoteProductError: Error | null = null;
      let settingErrors: Array<Error | null | void> = [];
      try {
        remoteProductError = await saveCatalogProduct(toCatalogProduct(updated));
        settingErrors = await Promise.all([
          saveProductSizes(nextProducts),
          saveProductSizeStock(nextProducts),
          saveProductVariants(nextProducts),
          saveProductVariantTypes(nextProducts),
          saveStoreSetting("productDamages", JSON.stringify(nextDamages)),
        ]);
      } catch (error) {
        settingErrors = [error instanceof Error ? error : new Error(String(error))];
      }
      setProducts(nextProducts);
      setSelectedProduct(updated);
      setProductDamages(nextDamages);
      persistCatalog(nextProducts);
      persistProductDamages(nextDamages);
      setDamageFormOpen(false);
      const remoteError = remoteProductError || settingErrors.find((error): error is Error => error instanceof Error);
      onNotify(remoteError ? "Damage recorded locally; Supabase needs its tables" : `${quantity} damaged unit${quantity === 1 ? "" : "s"} recorded`);
    } finally {
      setDamageSaving(false);
    }
  };
  const updateNewSizes = (value: string) => setNewProduct((current) => {
    const sizes = parseProductSizes(value);
    const sizeStock = Object.fromEntries(sizes.map((size) => [size, current.sizeStock[size] ?? ""]));
    return { ...current, sizes: value, sizeStock };
  });
  const defaultSupplierName = suppliers.find((supplier) => supplier.isDefault)?.name || "";
  const openAddProduct = (scannedFile?: File, scannedPreview?: string) => {
    setNewProduct({
      name: "",
      category: "Earrings",
      price: "₹",
      cost: "₹",
      stock: "",
      sku: "",
      barcode: "",
      hsnCode: "",
      billName: "",
      supplierName: defaultSupplierName,
      markup: "",
      gstRate: "",
      costWithGst: "₹",
      sizes: "",
      sizeStock: {},
      variants: [],
      variantType: "normal",
    });
    setNewProductImage(scannedPreview || adminPlaceholderImage);
    setNewProductFile(scannedFile || null);
    setNewProductHoverImage(adminPlaceholderImage);
    setNewProductHoverFile(null);
    setNewImageAdjustments(defaultImageAdjustments);
    setNewHoverAdjustments(defaultImageAdjustments);
    setNewImageAdjustmentsEnabled(false);
    setNewHoverAdjustmentsEnabled(false);
    setNewVariantAdjustmentsEnabled(false);
    setSelectedProduct(null);
    setIsEditing(false);
    setIsAdding(true);
  };
  const closeProductDetails = () => {
    setSelectedProduct(null);
    setIsEditing(false);
  };
  const saveProduct = async () => {
    if (!newProduct.name.trim()) return onNotify("Add a product name");
    if (!newProduct.supplierName.trim()) return onNotify("Select a supplier bill before saving the product");
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
    const newProductSizes = newProduct.variantType === "size" && newProduct.variants.length
      ? newProduct.variants.map((variant) => (variant.size || variant.name).trim()).filter(Boolean)
      : parseProductSizes(newProduct.sizes);
    const newProductSizeStock = newProduct.variantType === "size" && newProduct.variants.length
      ? Object.fromEntries(newProduct.variants.filter((variant) => (variant.size || variant.name).trim()).map((variant) => [(variant.size || variant.name).trim(), variant.stock === undefined ? "" : variant.stock])) as Record<string, number | "">
      : newProduct.sizeStock;
    const product: AdminProduct = {
      name: newProduct.name.trim(),
      sku: productSku,
      createdAt: new Date().toISOString(),
      category: newProduct.category,
      stock: Number(newProduct.stock) || 0,
      price: normalizeWholeSellingPrice(newProduct.price.trim() || "₹0"),
      cost: newProduct.cost.trim() || "₹0",
       status: hasSellableStock(newProduct.stock, newProduct.variantType, newProductSizes, newProductSizeStock, newProduct.variants) ? "Published" : "Draft",
      image: productImage,
      hoverImage: productHoverImage,
      barcode: newProduct.barcode.trim(),
      hsnCode: newProduct.hsnCode.trim(),
      billName: newProduct.billName.trim(),
      supplierName: newProduct.supplierName.trim(),
      gstRate: Number(newProduct.gstRate) || 0,
      markup: Number(newProduct.markup) || 0,
      costWithGst: newProduct.costWithGst,
       sizes: newProductSizes,
       sizeStock: normalizeSizeStock(newProductSizeStock),
      variantType: newProduct.variantType,
      variants: newVariantAdjustmentsEnabled
        ? newProduct.variants
        : newProduct.variants.map((variant) => ({ ...variant, adjustments: defaultImageAdjustments })),
      imageAdjustments: newImageAdjustmentsEnabled ? newImageAdjustments : defaultImageAdjustments,
      hoverImageAdjustments: newHoverAdjustmentsEnabled ? newHoverAdjustments : defaultImageAdjustments,
    };
    const remoteError = await saveCatalogProduct(toCatalogProduct(product));
    const nextProducts = [...products, product];
    setProducts(nextProducts);
    persistCatalog(nextProducts);
    // Finish the size/variant settings before reporting success so the
    // storefront cannot load the product row before its size metadata exists.
    await Promise.all([
      saveProductBarcodes(nextProducts),
      saveProductHsnCodes(nextProducts),
      saveProductBillNames(nextProducts),
      saveProductSupplierNames(nextProducts),
      saveProductPricing(nextProducts),
      saveProductSizes(nextProducts),
      saveProductSizeStock(nextProducts),
      saveProductVariants(nextProducts),
      saveProductVariantTypes(nextProducts),
      saveProductImageAdjustments(nextProducts),
    ]);
    setNewProduct({
      name: "",
      category: "Earrings",
      price: "₹",
      cost: "₹",
      stock: "",
      sku: "",
      barcode: "",
      hsnCode: "",
      billName: "",
      supplierName: "",
      markup: "",
      gstRate: "",
      costWithGst: "₹",
      sizes: "",
      sizeStock: {},
      variants: [],
      variantType: "normal",
    });
    setNewProductImage(adminPlaceholderImage);
    setNewProductFile(null);
    setNewProductHoverImage(adminPlaceholderImage);
    setNewProductHoverFile(null);
    setNewImageAdjustments(defaultImageAdjustments);
    setNewHoverAdjustments(defaultImageAdjustments);
    setNewImageAdjustmentsEnabled(false);
    setNewHoverAdjustmentsEnabled(false);
    setNewVariantAdjustmentsEnabled(false);
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
  const uploadVariantImage = async (
    mode: "new" | "edit",
    index: number,
    file: File,
  ) => {
    let image = "";
    try {
      image = await makeLocalImage(file);
    } catch {
      image = URL.createObjectURL(file);
    }
    if (isSupabaseReady) {
      const upload = await uploadStoreImage(file, "products");
      if (upload.url && !upload.error) image = upload.url;
    }
    if (mode === "new") {
      setNewProduct((current) => ({
        ...current,
        variants: current.variants.map((variant, variantIndex) =>
          variantIndex === index ? { ...variant, image } : variant,
        ),
      }));
    } else {
      setEditValues((current) => ({
        ...current,
        variants: current.variants.map((variant, variantIndex) =>
          variantIndex === index ? { ...variant, image } : variant,
        ),
      }));
    }
  };
  const updateNewVariant = (
    index: number,
    field: keyof ProductVariant,
    value: string,
  ) =>
    setNewProduct((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant,
      ),
    }));
  const updateEditVariant = (
    index: number,
    field: keyof ProductVariant,
    value: string,
  ) =>
    setEditValues((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant,
      ),
    }));
  const updateNewVariantAdjustments = (index: number, adjustments: ImageAdjustments) =>
    setNewProduct((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, adjustments } : variant,
      ),
    }));
  const updateEditVariantAdjustments = (index: number, adjustments: ImageAdjustments) =>
    setEditValues((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, adjustments } : variant,
      ),
    }));
  const updateEditField = (field: keyof typeof editValues, value: string) =>
    setEditValues((current) => {
      const next = { ...current, [field]: value };
      if (field === "cost" || field === "gstRate" || field === "markup") {
        const pricing = calculatePricing(next.cost, next.gstRate, next.markup);
        next.costWithGst = pricing.costWithGst;
        if (parseMoney(next.cost) > 0) next.price = pricing.price;
      }
      if (field === "price") next.markup = calculateMarkupFromSellingPrice(next.cost, next.gstRate, next.price);
      return next;
    });
  const updateEditSizes = (value: string) => setEditValues((current) => {
    const sizes = parseProductSizes(value);
    const sizeStock = Object.fromEntries(sizes.map((size) => [size, current.sizeStock[size] ?? ""]));
    return { ...current, sizes: value, sizeStock };
  });
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
      barcode: product.barcode || "",
      hsnCode: product.hsnCode || "",
      billName: product.billName || "",
      supplierName: product.supplierName || "",
      markup: calculateMarkupFromSellingPrice(product.cost, String(product.gstRate || 0), product.price),
      gstRate: String(product.gstRate || 0),
      costWithGst: product.costWithGst || product.cost,
      sizes: product.sizes?.join(", ") || "",
      sizeStock: product.sizeStock || {},
      variants: product.variants?.length
        ? product.variants.map((variant) => product.variantType === "size" && !variant.size ? { ...variant, name: "", size: variant.name } : variant)
        : product.variantType === "size" && product.sizes?.length
          ? product.sizes.map((size) => ({ name: "", size, image: "", stock: product.sizeStock?.[size] }))
          : [],
      variantType: product.variantType || (product.sizes?.length ? "size" : "normal"),
    });
    setEditImageAdjustments(product.imageAdjustments || defaultImageAdjustments);
    setEditHoverAdjustments(product.hoverImageAdjustments || defaultImageAdjustments);
    setEditImageAdjustmentsEnabled(hasImageAdjustments(product.imageAdjustments));
    setEditHoverAdjustmentsEnabled(hasImageAdjustments(product.hoverImageAdjustments));
    setEditVariantAdjustmentsEnabled(product.variants?.some((variant) => hasImageAdjustments(variant.adjustments)) ?? false);
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
    const editProductSizes = editValues.variantType === "size" && editValues.variants.length
      ? editValues.variants.map((variant) => (variant.size || variant.name).trim()).filter(Boolean)
      : parseProductSizes(editValues.sizes);
    const editProductSizeStock = editValues.variantType === "size" && editValues.variants.length
      ? Object.fromEntries(editValues.variants.filter((variant) => (variant.size || variant.name).trim()).map((variant) => [(variant.size || variant.name).trim(), variant.stock === undefined ? "" : variant.stock])) as Record<string, number | "">
      : editValues.sizeStock;
    const updated: AdminProduct = {
      ...selectedProduct,
      name: editValues.name.trim(),
      category: editValues.category,
      price: normalizeWholeSellingPrice(editValues.price.trim() || "₹0"),
      cost: editValues.cost.trim() || "₹0",
      stock: Number(editValues.stock) || 0,
      sku: editValues.sku.trim() || selectedProduct.sku,
       status: hasSellableStock(editValues.stock, editValues.variantType, editProductSizes, editProductSizeStock, editValues.variants) ? "Published" : "Draft",
      image,
      hoverImage,
      barcode: editValues.barcode.trim(),
      hsnCode: editValues.hsnCode.trim(),
      billName: editValues.billName.trim(),
      supplierName: editValues.supplierName.trim(),
      gstRate: Number(editValues.gstRate) || 0,
      markup: Number(editValues.markup) || 0,
      costWithGst: editValues.costWithGst,
       sizes: editProductSizes,
       sizeStock: normalizeSizeStock(editProductSizeStock),
      variantType: editValues.variantType,
      variants: editVariantAdjustmentsEnabled
        ? editValues.variants
        : editValues.variants.map((variant) => ({ ...variant, adjustments: defaultImageAdjustments })),
      imageAdjustments: editImageAdjustmentsEnabled ? editImageAdjustments : defaultImageAdjustments,
      hoverImageAdjustments: editHoverAdjustmentsEnabled ? editHoverAdjustments : defaultImageAdjustments,
    };
    const remoteError = await saveCatalogProduct(toCatalogProduct(updated));
    if (!remoteError && updated.sku !== selectedProduct.sku)
      await removeCatalogProduct(selectedProduct.sku);
    const nextProducts = products.map((product) =>
      product.sku === selectedProduct.sku ? updated : product,
    );
    setProducts(nextProducts);
    persistCatalog(nextProducts);
    await Promise.all([
      saveProductBarcodes(nextProducts),
      saveProductHsnCodes(nextProducts),
      saveProductBillNames(nextProducts),
      saveProductSupplierNames(nextProducts),
      saveProductPricing(nextProducts),
      saveProductSizes(nextProducts),
      saveProductSizeStock(nextProducts),
      saveProductVariants(nextProducts),
      saveProductVariantTypes(nextProducts),
      saveProductImageAdjustments(nextProducts),
    ]);
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
      void saveProductBarcodes(next);
      void saveProductHsnCodes(next);
      void saveProductBillNames(next);
      void saveProductSupplierNames(next);
      void saveProductPricing(next);
      void saveProductSizes(next);
      void saveProductSizeStock(next);
      void saveProductVariants(next);
      void saveProductImageAdjustments(next);
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
    const barcodeColumn = findColumn(["barcode", "bar code", "ean", "upc"]);
    const hsnCodeColumn = findColumn(["hsn", "hsn code", "hsncode"]);
    const billNameColumn = findColumn(["bill name", "invoice name", "billing name"]);
    const supplierNameColumn = findColumn(["supplier bill", "supplier name", "supplier", "vendor name"]);
    const sizesColumn = findColumn(["sizes", "size", "available sizes"]);
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
          barcode: barcodeColumn >= 0 ? row[barcodeColumn]?.trim() || "" : "",
          hsnCode: hsnCodeColumn >= 0 ? row[hsnCodeColumn]?.trim() || "" : "",
          billName: billNameColumn >= 0 ? row[billNameColumn]?.trim() || "" : "",
          supplierName: supplierNameColumn >= 0 ? row[supplierNameColumn]?.trim() || "" : "",
          sizes: sizesColumn >= 0 ? parseProductSizes(row[sizesColumn]?.trim() || "") : [],
          status: stock > 0 ? "Published" : "Draft",
          image: adminPlaceholderImage,
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
        void saveProductBarcodes(next);
        void saveProductHsnCodes(next);
        void saveProductBillNames(next);
        void saveProductSupplierNames(next);
        void saveProductPricing(next);
        void saveProductSizes(next);
        void saveProductVariants(next);
        void saveProductImageAdjustments(next);
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
  const exportCsv = () => {
    const headers = ["name", "billName", "supplierBill", "sku", "barcode", "hsnCode", "category", "sizes", "stock", "price", "cost", "status", "image", "hoverImage"];
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = products.map((product) => [
      product.name,
      product.billName || "",
      product.supplierName || "",
      product.sku,
      product.barcode || "",
      product.hsnCode || "",
      product.category,
      (product.sizes || []).join(", "),
      product.stock,
      product.price,
      product.cost,
      product.status,
      product.image,
      product.hoverImage || "",
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fanzzy-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    onNotify(`${products.length} product${products.length === 1 ? "" : "s"} exported`);
  };
  const scannerPanel = <ProductImageScanner products={products} promotionOffers={promotionOffers} onClose={() => setScannerOpen(false)} onView={(product) => { setScannerOpen(false); setSelectedProduct(product); setIsAdding(false); setIsEditing(false); }} onEdit={(product) => { setScannerOpen(false); startEditing(product); }} onUpdateStock={(product) => { setScannerOpen(false); startEditing(product); }} onAddNew={(file, preview) => { setScannerOpen(false); openAddProduct(file, preview); }} />;
  if (scannerOnly) {
    return (
      <section className="panel module-workspace">
        {scannerOpen ? scannerPanel : <div className="scanner-dropzone"><span>✦</span><strong>Product Image Scanner</strong><small>Open the live camera whenever you are ready to check a product.</small><div className="scanner-actions"><button className="module-primary" onClick={() => setScannerOpen(true)}>Open scanner</button></div></div>}
      </section>
    );
  }
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
          <button className="module-secondary" onClick={exportCsv}>
            Export CSV ↗
          </button>
          <button className="module-primary" onClick={() => openAddProduct()}>
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
              <ImageAdjustmentPreview src={newProductImage} alt="Product preview" adjustments={newImageAdjustments} enabled={newImageAdjustmentsEnabled} onClick={() => newProductImageInputRef.current?.click()} onChange={setNewImageAdjustments} />
              <label>
                <strong>Upload product image</strong>
                <small>JPG, PNG or WEBP · click to choose</small>
                <input
                  ref={newProductImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadProductImage}
                />
              </label>
              <PhotoAdjustmentToggle enabled={newImageAdjustmentsEnabled} onChange={setNewImageAdjustmentsEnabled} />
              {newImageAdjustmentsEnabled && <ImageAdjustmentControls adjustments={newImageAdjustments} onChange={setNewImageAdjustments} />}
            </div>
            <div className="product-image-upload hover-image-upload">
              <ImageAdjustmentPreview src={newProductHoverImage} alt="Product hover preview" adjustments={newHoverAdjustments} enabled={newHoverAdjustmentsEnabled} onClick={() => newProductHoverImageInputRef.current?.click()} onChange={setNewHoverAdjustments} />
              <label>
                <strong>Upload hover image</strong>
                <small>Shown when customers point at this product</small>
                <input
                  ref={newProductHoverImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={uploadProductHoverImage}
                />
              </label>
              <PhotoAdjustmentToggle enabled={newHoverAdjustmentsEnabled} onChange={setNewHoverAdjustmentsEnabled} />
              {newHoverAdjustmentsEnabled && <ImageAdjustmentControls adjustments={newHoverAdjustments} onChange={setNewHoverAdjustments} />}
            </div>
            <div className="variant-type-selector form-wide">
              <label>
                Stock tracking method
                <select aria-label="Stock tracking method" value={newProduct.variantType} onChange={(event) => setNewProduct((current) => ({ ...current, variantType: event.target.value as ProductVariantType }))}>
                  <option value="normal">VARIANT STOCK — colour / model wise</option>
                  <option value="size">SIZE STOCK — add size variants</option>
                </select>
                <small className="field-help">Normal variants reduce the selected variant stock. Size variants reduce the selected size stock.</small>
              </label>
            </div>
            <div className="variant-editor">
              <div className="variant-editor-heading">
                <div>
                    <p className="eyebrow">{newProduct.variantType === "size" ? "SIZE VARIANTS" : "COLOUR / SERIES / MODEL VARIANTS"}</p>
                    <small>{newProduct.variantType === "size" ? "Add each size as a variant with its own image and size stock." : "Add a separate customer-selectable image for each variant. Drag its preview to adjust the position."}</small>
                </div>
                <div className="variant-editor-actions">
                  <VariantAdjustmentToggle enabled={newVariantAdjustmentsEnabled} onChange={setNewVariantAdjustmentsEnabled} />
                  <button
                    className="module-secondary variant-add"
                    type="button"
                    onClick={() =>
                      setNewProduct((current) => ({
                        ...current,
                        stock: current.variants.length ? current.stock : "",
                        variants: [...current.variants, { name: "", size: current.variantType === "size" ? "" : undefined, image: "", adjustments: defaultImageAdjustments }],
                      }))
                    }
                  >
                      {newProduct.variantType === "size" ? "+ Add size variant" : "+ Add variant"}
                  </button>
                </div>
              </div>
              {newProduct.variants.length ? (
                <div className="variant-editor-list">
                  {newProduct.variants.map((variant, index) => (
                    <div className={`variant-editor-row ${newProduct.variantType === "size" ? "size-variant-row" : ""}`} key={`new-variant-${index}`}>
                      <label className="variant-name-field">
                        Variant name
                        <input
                          value={variant.name}
                          onChange={(event) => updateNewVariant(index, "name", event.target.value)}
                          placeholder={newProduct.variantType === "size" ? "e.g. Classic" : "e.g. Rose gold / Model 2"}
                          aria-label={`Variant ${index + 1} name`}
                        />
                      </label>
                      {newProduct.variantType === "size" && (
                        <label className="variant-size-field">
                          Size
                          <input
                            value={variant.size ?? ""}
                            onChange={(event) => setNewProduct((current) => ({
                              ...current,
                              variants: current.variants.map((item, variantIndex) => variantIndex === index ? { ...item, size: event.target.value } : item),
                            }))}
                            placeholder="e.g. 6"
                            aria-label={`Size ${index + 1}`}
                          />
                        </label>
                      )}
                      <label className="variant-stock-field">
                         {newProduct.variantType === "size" ? "Size stock" : "Variant stock"}
                        <input
                          type="number"
                          min="0"
                          value={variant.stock ?? ""}
                          onChange={(event) => setNewProduct((current) => ({
                            ...current,
                            variants: current.variants.map((item, variantIndex) => variantIndex === index ? { ...item, stock: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) } : item),
                          }))}
                          onWheel={(event) => event.currentTarget.blur()}
                          placeholder="0"
                          aria-label={`${newProduct.variantType === "size" ? "Size" : "Variant"} ${index + 1} stock`}
                        />
                      </label>
                      <ImageAdjustmentPreview className="variant-adjust-preview" src={variant.image} alt="Variant preview" adjustments={variant.adjustments || defaultImageAdjustments} enabled={newVariantAdjustmentsEnabled} onClick={() => newVariantImageInputRefs.current[index]?.click()} onChange={(adjustments) => updateNewVariantAdjustments(index, adjustments)} />
                      <label className="variant-upload">
                        Upload image
                        <input
                          ref={(element) => { newVariantImageInputRefs.current[index] = element; }}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadVariantImage("new", index, file);
                          }}
                        />
                      </label>
                      <button
                        className="variant-remove"
                        type="button"
                        onClick={() =>
                          setNewProduct((current) => ({
                            ...current,
                            variants: current.variants.filter((_, variantIndex) => variantIndex !== index),
                          }))
                        }
                        aria-label={`Remove variant ${index + 1}`}
                      >
                        ×
                      </button>
                      {newVariantAdjustmentsEnabled && <ImageAdjustmentControls
                        adjustments={variant.adjustments || defaultImageAdjustments}
                        onChange={(adjustments) => updateNewVariantAdjustments(index, adjustments)}
                      />}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="variant-empty">No variants added yet.</p>
              )}
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
                Bill name
                <input
                  value={newProduct.billName}
                  onChange={(event) => updateField("billName", event.target.value)}
                  placeholder="Name to show on the customer bill"
                />
              </label>
              <label>
                Supplier bill
                <select value={newProduct.supplierName} onChange={(event) => updateField("supplierName", event.target.value)}>
                  <option value="">Select supplier bill</option>
                  {Array.from(new Set([newProduct.supplierName, ...suppliers.map((supplier) => supplier.name)].filter(Boolean))).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                {!suppliers.length && <small className="field-help">Create supplier bills from the Suppliers sidebar first.</small>}
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
                Barcode
                <input
                  value={newProduct.barcode}
                  onChange={(event) => updateField("barcode", event.target.value)}
                  placeholder="Scan or enter barcode"
                  inputMode="numeric"
                />
              </label>
              <label>
                HSN code
                <input
                  value={newProduct.hsnCode}
                  onChange={(event) => updateField("hsnCode", event.target.value)}
                  placeholder="e.g. 7117"
                  inputMode="numeric"
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
                  {Array.from(new Set([newProduct.category, ...categoryOptions].filter(Boolean))).map((category) => (
                    <option key={category}>{category}{catalogCategories.find((item) => item.name.toLowerCase() === category.toLowerCase())?.section === "luxury" ? "  ·  LX" : ""}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: newProduct.variantType === "size" && !newProduct.variants.length ? undefined : "none" }}>
                Available sizes
                <input
                  value={newProduct.sizes}
                  onChange={(event) => updateNewSizes(event.target.value)}
                  placeholder="e.g. 6, 7, 8"
                />
                <small className="field-help">Separate multiple sizes with commas.</small>
              </label>
              {newProduct.variantType === "size" && !newProduct.variants.length && parseProductSizes(newProduct.sizes).length > 0 && <div className="size-stock-editor form-wide"><span className="field-label">Stock by size</span><div>{parseProductSizes(newProduct.sizes).map((size) => <label key={size}>{size}<input type="number" min="0" step="1" value={newProduct.sizeStock[size] ?? ""} onChange={(event) => setNewProduct((current) => ({ ...current, sizeStock: { ...current.sizeStock, [size]: event.target.value === "" ? "" : Number(event.target.value) } }))} placeholder="Quantity" onWheel={(event) => event.currentTarget.blur()} /></label>)}</div></div>}
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
                  GST %
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newProduct.gstRate}
                    onChange={(event) => updateField("gstRate", event.target.value)}
                    onWheel={(event) => event.currentTarget.blur()}
                    placeholder="e.g. 5"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Cost incl. GST
                  <input value={newProduct.costWithGst} readOnly aria-label="Cost including GST" />
                </label>
                <label>
                  Markup %
                  <span className="percentage-input">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newProduct.markup}
                      onChange={(event) => updateField("markup", event.target.value)}
                      onWheel={(event) => event.currentTarget.blur()}
                      placeholder="e.g. 25"
                      inputMode="decimal"
                    />
                    <b>%</b>
                  </span>
                </label>
                <label>
                  Selling price
                  <input
                    value={newProduct.price}
                    onChange={(event) => updateField("price", event.target.value)}
                    placeholder="Calculated from cost + markup"
                  />
                </label>
                    {!((newProduct.variantType === "normal" || newProduct.variantType === "size") && newProduct.variants.length) && <label className={newProduct.variants.length ? "product-stock-disabled" : ""}>
                  Stock {newProduct.variants.length ? <small>Use variant stock below</small> : null}
                <input
                  type="number"
                  min="0"
                  value={newProduct.stock}
                  onChange={(event) => updateField("stock", event.target.value)}
                  onWheel={(event) => event.currentTarget.blur()}
                  placeholder="0"
                  disabled={newProduct.variants.length > 0}
                />
              </label>}
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
        <span>{filteredProducts.length} of {products.length} active records</span>
      </div>
      <div className="product-library-filters" role="search" aria-label="Filter products">
        <label className="product-library-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Search products, SKU, barcode or variant"
            aria-label="Search products"
          />
        </label>
        <label>
          <span>Category</span>
          <select value={productCategoryFilter} onChange={(event) => setProductCategoryFilter(event.target.value)} aria-label="Filter by category">
            <option value="all">All categories</option>
            {productCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label>
          <span>Variant</span>
          <select value={productVariantFilter} onChange={(event) => setProductVariantFilter(event.target.value)} aria-label="Filter by variant">
            <option value="all">All products</option>
            <option value="with-variants">Variant products only</option>
          </select>
        </label>
        <label>
          <span>Supplier bill</span>
          <select value={productSupplierFilter} onChange={(event) => setProductSupplierFilter(event.target.value)} aria-label="Filter by supplier bill">
            <option value="all">All supplier bills</option>
            {productSuppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </select>
        </label>
        {(productSearch || productCategoryFilter !== "all" || productVariantFilter !== "all" || productSupplierFilter !== "all") && (
          <button
            className="product-library-filter-reset"
            type="button"
            onClick={() => {
              setProductSearch("");
              setProductCategoryFilter("all");
              setProductVariantFilter("all");
              setProductSupplierFilter("all");
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="module-list">
        {filteredProducts.map((product, index) => (
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
              <span className="product-row-thumb">
                <img src={product.image} alt="" />
              </span>
              <strong>{product.name}</strong>
              <small>
                {product.stock === 0 ? "Draft" : `${product.stock} in stock`} ·{" "}
                {product.category}{product.barcode ? ` · Barcode ${product.barcode}` : ""}
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
        {filteredProducts.length === 0 && (
          <div className="product-library-empty">
            <strong>No products match these filters</strong>
            <span>Try another search, category, or variant.</span>
          </div>
        )}
      </div>
      {selectedProduct && isEditing && (
        <div className="product-form-card">
          <p className="eyebrow">EDIT PRODUCT</p>
          <h3>Edit {selectedProduct.name}</h3>
          <div className="product-image-upload">
            <ImageAdjustmentPreview src={editValues.image || selectedProduct.image} alt="Product main image preview" adjustments={editImageAdjustments} enabled={editImageAdjustmentsEnabled} onClick={() => editProductImageInputRef.current?.click()} onChange={setEditImageAdjustments} />
            <label>
              <strong>Upload main image</strong>
              <small>Shown as the primary product image</small>
              <input
                ref={editProductImageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadEditImage}
              />
            </label>
            <PhotoAdjustmentToggle enabled={editImageAdjustmentsEnabled} onChange={setEditImageAdjustmentsEnabled} />
            {editImageAdjustmentsEnabled && <ImageAdjustmentControls adjustments={editImageAdjustments} onChange={setEditImageAdjustments} />}
          </div>
          <div className="product-image-upload hover-image-upload">
            <ImageAdjustmentPreview src={editValues.hoverImage || selectedProduct.image} alt="Product hover preview" adjustments={editHoverAdjustments} enabled={editHoverAdjustmentsEnabled} onClick={() => editProductHoverImageInputRef.current?.click()} onChange={setEditHoverAdjustments} />
            <label>
              <strong>Upload hover image</strong>
              <small>Shown when customers point at this product</small>
              <input
                ref={editProductHoverImageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadEditHoverImage}
              />
            </label>
            <PhotoAdjustmentToggle enabled={editHoverAdjustmentsEnabled} onChange={setEditHoverAdjustmentsEnabled} />
            {editHoverAdjustmentsEnabled && <ImageAdjustmentControls adjustments={editHoverAdjustments} onChange={setEditHoverAdjustments} />}
          </div>
            <div className="variant-type-selector form-wide">
              <label>
                Stock tracking method
                <select aria-label="Stock tracking method" value={editValues.variantType} onChange={(event) => setEditValues((current) => ({ ...current, variantType: event.target.value as ProductVariantType }))}>
                  <option value="normal">VARIANT STOCK — colour / model wise</option>
                  <option value="size">SIZE STOCK — add size variants</option>
                </select>
                <small className="field-help">Normal variants reduce the selected variant stock. Size variants reduce the selected size stock.</small>
              </label>
            </div>
            <div className="variant-editor">
            <div className="variant-editor-heading">
              <div>
                <p className="eyebrow">{editValues.variantType === "size" ? "SIZE VARIANTS" : "COLOUR / SERIES / MODEL VARIANTS"}</p>
                <small>{editValues.variantType === "size" ? "Add each size as a variant with its own image and size stock." : "Add a separate customer-selectable image for each variant. Drag its preview to adjust the position."}</small>
              </div>
              <div className="variant-editor-actions">
                <VariantAdjustmentToggle enabled={editVariantAdjustmentsEnabled} onChange={setEditVariantAdjustmentsEnabled} />
                <button
                  className="module-secondary variant-add"
                  type="button"
                  onClick={() =>
                    setEditValues((current) => ({
                      ...current,
                      stock: current.variants.length ? current.stock : "",
                      variants: [...current.variants, { name: "", size: current.variantType === "size" ? "" : undefined, image: "", adjustments: defaultImageAdjustments }],
                    }))
                  }
                >
                  {editValues.variantType === "size" ? "+ Add size variant" : "+ Add variant"}
                </button>
              </div>
            </div>
            {editValues.variants.length ? (
              <div className="variant-editor-list">
                  {editValues.variants.map((variant, index) => (
                    <div className={`variant-editor-row ${editValues.variantType === "size" ? "size-variant-row" : ""}`} key={`edit-variant-${index}`}>
                    <label className="variant-name-field">
                      Variant name
                      <input
                        value={variant.name}
                        onChange={(event) => updateEditVariant(index, "name", event.target.value)}
                        placeholder={editValues.variantType === "size" ? "e.g. Classic" : "e.g. Rose gold / Model 2"}
                        aria-label={`Variant ${index + 1} name`}
                      />
                    </label>
                    {editValues.variantType === "size" && (
                      <label className="variant-size-field">
                        Size
                        <input
                          value={variant.size ?? ""}
                          onChange={(event) => setEditValues((current) => ({
                            ...current,
                            variants: current.variants.map((item, variantIndex) => variantIndex === index ? { ...item, size: event.target.value } : item),
                          }))}
                          placeholder="e.g. 6"
                          aria-label={`Size ${index + 1}`}
                        />
                      </label>
                    )}
                      <label className="variant-stock-field">
                       {editValues.variantType === "size" ? "Size stock" : "Variant stock"}
                      <input
                        type="number"
                        min="0"
                        value={variant.stock ?? ""}
                        onChange={(event) => setEditValues((current) => ({
                          ...current,
                          variants: current.variants.map((item, variantIndex) => variantIndex === index ? { ...item, stock: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0) } : item),
                        }))}
                        onWheel={(event) => event.currentTarget.blur()}
                        placeholder="0"
                        aria-label={`${editValues.variantType === "size" ? "Size" : "Variant"} ${index + 1} stock`}
                      />
                    </label>
                    <ImageAdjustmentPreview className="variant-adjust-preview" src={variant.image} alt="Variant preview" adjustments={variant.adjustments || defaultImageAdjustments} enabled={editVariantAdjustmentsEnabled} onClick={() => editVariantImageInputRefs.current[index]?.click()} onChange={(adjustments) => updateEditVariantAdjustments(index, adjustments)} />
                    <label className="variant-upload">
                      Upload image
                      <input
                        ref={(element) => { editVariantImageInputRefs.current[index] = element; }}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadVariantImage("edit", index, file);
                        }}
                      />
                    </label>
                    <button
                      className="variant-remove"
                      type="button"
                      onClick={() =>
                        setEditValues((current) => ({
                          ...current,
                          variants: current.variants.filter((_, variantIndex) => variantIndex !== index),
                        }))
                      }
                      aria-label={`Remove variant ${index + 1}`}
                    >
                      ×
                    </button>
                    {editVariantAdjustmentsEnabled && <ImageAdjustmentControls
                      adjustments={variant.adjustments || defaultImageAdjustments}
                      onChange={(adjustments) => updateEditVariantAdjustments(index, adjustments)}
                    />}
                  </div>
                ))}
              </div>
            ) : (
              <p className="variant-empty">No variants added yet.</p>
            )}
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
              Bill name
              <input
                value={editValues.billName}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    billName: event.target.value,
                  }))
                }
                placeholder="Name to show on the customer bill"
              />
            </label>
            <label>
              Supplier bill
              <select value={editValues.supplierName} onChange={(event) => updateEditField("supplierName", event.target.value)}>
                <option value="">Select supplier bill</option>
                {Array.from(new Set([editValues.supplierName, ...suppliers.map((supplier) => supplier.name)].filter(Boolean))).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
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
                Barcode
                <input
                value={editValues.barcode}
                onChange={(event) =>
                  setEditValues((current) => ({
                    ...current,
                    barcode: event.target.value,
                  }))
                }
                placeholder="Scan or enter barcode"
                  inputMode="numeric"
                />
              </label>
              <label>
                HSN code
                <input
                  value={editValues.hsnCode}
                  onChange={(event) =>
                    setEditValues((current) => ({
                      ...current,
                      hsnCode: event.target.value,
                    }))
                  }
                  placeholder="e.g. 7117"
                  inputMode="numeric"
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
                {Array.from(new Set([editValues.category, ...categoryOptions].filter(Boolean))).map((category) => (
                  <option key={category}>{category}{catalogCategories.find((item) => item.name.toLowerCase() === category.toLowerCase())?.section === "luxury" ? "  ·  LX" : ""}</option>
                ))}
              </select>
            </label>
            <label style={{ display: editValues.variantType === "size" && !editValues.variants.length ? undefined : "none" }}>
              Available sizes
              <input
                value={editValues.sizes}
                onChange={(event) => updateEditSizes(event.target.value)}
                placeholder="e.g. 6, 7, 8"
              />
              <small className="field-help">Separate multiple sizes with commas.</small>
            </label>
            {editValues.variantType === "size" && !editValues.variants.length && parseProductSizes(editValues.sizes).length > 0 && <div className="size-stock-editor form-wide"><span className="field-label">Stock by size</span><div>{parseProductSizes(editValues.sizes).map((size) => <label key={size}>{size}<input type="number" min="0" step="1" value={editValues.sizeStock[size] ?? ""} onChange={(event) => setEditValues((current) => ({ ...current, sizeStock: { ...current.sizeStock, [size]: event.target.value === "" ? "" : Number(event.target.value) } }))} placeholder="Quantity" onWheel={(event) => event.currentTarget.blur()} /></label>)}</div></div>}
                <label>
                  Cost price
                  <input
                    value={editValues.cost}
                    onChange={(event) => updateEditField("cost", event.target.value)}
                    placeholder="₹0"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  GST %
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.gstRate}
                    onChange={(event) => updateEditField("gstRate", event.target.value)}
                    onWheel={(event) => event.currentTarget.blur()}
                    placeholder="e.g. 5"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Cost incl. GST
                  <input value={editValues.costWithGst} readOnly aria-label="Cost including GST" />
                </label>
                <label>
                  Markup %
                  <span className="percentage-input">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editValues.markup}
                      onChange={(event) => updateEditField("markup", event.target.value)}
                      onWheel={(event) => event.currentTarget.blur()}
                      placeholder="e.g. 25"
                      inputMode="decimal"
                    />
                    <b>%</b>
                  </span>
                </label>
                <label>
                  Selling price
                  <input
                    value={editValues.price}
                    onChange={(event) => updateEditField("price", event.target.value)}
                    placeholder="Calculated from cost + markup"
                  />
                </label>
                {!((editValues.variantType === "normal" || editValues.variantType === "size") && editValues.variants.length) && <label className={editValues.variants.length ? "product-stock-disabled" : ""}>
                  Stock {editValues.variants.length ? <small>Use variant stock below</small> : null}
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
                disabled={editValues.variants.length > 0}
                onWheel={(event) => event.currentTarget.blur()}
              />
            </label>}
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
      {selectedProduct && !isEditing && !damageFormOpen && (
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
                  {selectedLiveStock} units
                </strong>
              </span>
              <span>
                <small>Damaged stock</small>
                <strong>{(productDamages[selectedProduct.sku] || []).reduce((total, record) => total + record.quantity, 0)} units</strong>
              </span>
              <span>
                <small>Status</small>
                <strong>{selectedProduct.status}</strong>
              </span>
              <span>
                <small>Barcode</small>
                <strong>{selectedProduct.barcode || "Not added"}</strong>
              </span>
              <span>
                <small>HSN code</small>
                <strong>{selectedProduct.hsnCode || "Not added"}</strong>
              </span>
              <span>
                <small>Bill name</small>
                <strong>{selectedProduct.billName || selectedProduct.name}</strong>
              </span>
              <span>
                <small>Supplier bill</small>
                <strong>{selectedProduct.supplierName || "Not selected"}</strong>
              </span>
              <span>
                <small>Available sizes</small>
                <strong>{selectedProduct.sizes?.length ? selectedProduct.sizes.join(", ") : "Not added"}</strong>
              </span>
            </div>
            {(productDamages[selectedProduct.sku] || []).length > 0 && (
              <div className="damage-history">
                <p className="eyebrow">DAMAGE HISTORY</p>
                {(productDamages[selectedProduct.sku] || []).slice(-3).reverse().map((record) => (
                  <div className="damage-history-row" key={record.id}>
                    <strong>{record.quantity} unit{record.quantity === 1 ? "" : "s"} · {record.stockScope}</strong>
                    <span>{record.reason} · {new Date(record.createdAt).toLocaleDateString("en-IN")}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="product-detail-actions">
              <button
                className="module-primary"
                onClick={() => openDamageForm(selectedProduct)}
              >
                Add damaged stock
              </button>
              <button
                className="module-secondary"
                onClick={() => startEditing(selectedProduct)}
              >
                Edit product
              </button>
              <button
                className="module-secondary"
                onClick={closeProductDetails}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {damageFormOpen && selectedProduct && (
        <div className="product-modal-backdrop damage-modal-backdrop" onClick={() => setDamageFormOpen(false)}>
          <div className="product-detail-card damage-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="product-detail-copy">
              <p className="eyebrow">INVENTORY ADJUSTMENT</p>
              <h3>Record damaged stock</h3>
              <p className="product-detail-meta">{selectedProduct.name} · {selectedProduct.sku}</p>
              <p className="field-help">Damaged stock is removed from the live storefront inventory immediately.</p>
              <div className="product-form-grid damage-form-grid">
                {damageOptions.length > 0 && (
                  <label>
                    Damaged variant / size
                    <select value={damageVariantKey} onChange={(event) => setDamageVariantKey(event.target.value)}>
                      <option value="">Select an option</option>
                      {damageOptions.map((option) => (
                        <option key={option.key} value={option.key} disabled={option.stock < 1}>
                          {option.label} · {option.stock} available
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Damaged quantity
                  <input type="number" min="1" step="1" value={damageQuantity} onChange={(event) => setDamageQuantity(event.target.value)} onWheel={(event) => event.currentTarget.blur()} />
                </label>
                <label className="form-wide">
                  Reason
                  <input value={damageReason} onChange={(event) => setDamageReason(event.target.value)} placeholder="e.g. Broken, scratched, or missing stone" />
                </label>
              </div>
              <div className="damage-available-note">
                <span>Live stock now</span>
                <strong>{selectedLiveStock} units</strong>
              </div>
              <div className="product-detail-actions">
                <button className="module-primary" disabled={damageSaving} onClick={() => void saveDamage()}>{damageSaving ? "Saving damage…" : "Save damage"}</button>
                <button className="module-secondary" onClick={() => setDamageFormOpen(false)}>Cancel</button>
              </div>
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

export default AdminLoginGate;
