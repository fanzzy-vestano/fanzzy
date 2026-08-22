export type VendorAccountStatus = "Active" | "Suspended" | "Inactive";
export type VendorProductStatus = "Draft" | "Pending Approval" | "Approved" | "Rejected" | "Inactive" | "Out of Stock";
export type VendorOrderStatus = "New" | "Accepted" | "Processing" | "Ready to Ship" | "Shipped" | "Delivered" | "Cancelled" | "Return Requested" | "Returned" | "Refunded";
export type PayoutStatus = "Not Eligible" | "Pending" | "Approved" | "Processing" | "Paid" | "Failed" | "On Hold" | "Cancelled";

export type VendorPublic = {
  id: string;
  slug: string;
  businessName: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  featured: boolean;
  productCount?: number;
};

export type CommissionRule = {
  source: "product" | "category" | "vendor" | "global";
  mode: "percentage" | "fixed";
  rate: number;
  fixedAmount: number;
};

export type CommissionInput = {
  grossProductAmount: number;
  allocatedDiscount: number;
  rule: CommissionRule;
};

export type CommissionResult = CommissionInput & {
  commissionAmount: number;
  vendorNetAmount: number;
};

export function slugifyVendorName(value: string) {
  const slug = value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "vendor";
}

export function allocateProRata(total: number, amounts: number[]) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeAmounts = amounts.map((amount) => Math.max(0, Number(amount) || 0));
  const denominator = safeAmounts.reduce((sum, amount) => sum + amount, 0);
  if (!denominator || !safeTotal) return safeAmounts.map(() => 0);
  const allocations = safeAmounts.map((amount) => Math.round((safeTotal * amount / denominator) * 100) / 100);
  const remainder = Math.round((safeTotal - allocations.reduce((sum, amount) => sum + amount, 0)) * 100) / 100;
  if (remainder) allocations[allocations.length - 1] = Math.round((allocations[allocations.length - 1] + remainder) * 100) / 100;
  return allocations;
}

export function calculateCommission(input: CommissionInput): CommissionResult {
  const netProductAmount = Math.max(0, input.grossProductAmount - input.allocatedDiscount);
  const commissionAmount = input.rule.mode === "fixed"
    ? Math.min(netProductAmount, Math.max(0, input.rule.fixedAmount))
    : Math.min(netProductAmount, Math.max(0, netProductAmount * Math.max(0, input.rule.rate) / 100));
  return {
    ...input,
    commissionAmount: Math.round(commissionAmount * 100) / 100,
    vendorNetAmount: Math.round((netProductAmount - commissionAmount) * 100) / 100,
  };
}

export function resolveCommissionRule(rules: {
  product?: CommissionRule;
  category?: CommissionRule;
  vendor?: CommissionRule;
  global: CommissionRule;
}) {
  return rules.product || rules.category || rules.vendor || rules.global;
}

export type MarketplaceOrderItem = {
  productId?: string;
  sku?: string;
  name: string;
  quantity: number;
  price: string;
  discount?: number;
  tax?: number;
  shipping?: number;
  vendorId?: string | null;
  vendorName?: string;
  vendorSlug?: string;
  [key: string]: unknown;
};

export type MarketplaceOrder = {
  id: string;
  total: string;
  items?: MarketplaceOrderItem[];
  [key: string]: unknown;
};

export function groupOrderItemsByVendor(order: MarketplaceOrder, productVendors: Record<string, { vendorId?: string | null; vendorName?: string; vendorSlug?: string }>) {
  const groups = new Map<string, MarketplaceOrderItem[]>();
  for (const item of order.items || []) {
    const key = String(item.vendorId || productVendors[item.productId || item.sku || ""]?.vendorId || "platform");
    const resolved = productVendors[item.productId || item.sku || ""];
    const enriched = {
      ...item,
      vendorId: item.vendorId ?? resolved?.vendorId ?? null,
      vendorName: item.vendorName ?? resolved?.vendorName,
      vendorSlug: item.vendorSlug ?? resolved?.vendorSlug,
    };
    groups.set(key, [...(groups.get(key) || []), enriched]);
  }
  return Array.from(groups.entries()).map(([vendorId, items]) => ({
    vendorId: vendorId === "platform" ? null : vendorId,
    items,
    itemTotal: Math.round(items.reduce((sum, item) => sum + (Number(String(item.price).replace(/[^0-9.-]/g, "")) || 0) * Math.max(0, Number(item.quantity) || 0), 0) * 100) / 100,
  }));
}

export const vendorProductIsPublic = (vendor: { status?: string; storeVisibility?: string }, product: { status?: string; vendorStatus?: string; publicVendorVisible?: boolean }) =>
  vendor.status === "Active" && vendor.storeVisibility === "Visible" && product.vendorStatus === "Approved" && product.publicVendorVisible !== false;
