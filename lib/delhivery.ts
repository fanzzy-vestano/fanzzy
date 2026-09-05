type DelhiveryAddress = {
  name: string;
  address: string;
  phone: string;
  pincode: string;
};

export type DelhiveryOrderItem = {
  name: string;
  quantity: number;
  price: string;
  hsnCode?: string;
};

export type DelhiveryOrder = {
  id: string;
  total: string;
  customerName: string;
  phone: string;
  address?: string;
  paymentMethod?: "online" | "cod";
  items?: DelhiveryOrderItem[];
};

export type DelhiveryShipmentResult = {
  waybill: string;
  status: string;
  trackingUrl: string;
};

export type DelhiveryPickupRequestResult = {
  pickupId?: string;
  pickupDate: string;
  pickupTime: string;
  expectedPackageCount: number;
  status: string;
};

export type DelhiveryTrackingResult = {
  waybill: string;
  status: string;
  statusType?: string;
  statusDate?: string;
  location?: string;
  scans: Array<{ status: string; date?: string; location?: string; instructions?: string }>;
};

const createEndpoint = "https://track.delhivery.com/api/cmu/create.json";
const pickupRequestEndpoint = "https://track.delhivery.com/fm/request/new/";
const trackingEndpoint = "https://track.delhivery.com/api/v1/packages/json/";
const pincodeEndpoint = "https://track.delhivery.com/c/api/pin-codes/json/";

const config = () => ({
  token: String(process.env.DELHIVERY_API_TOKEN || "").trim(),
  client: String(process.env.DELHIVERY_CLIENT_NAME || "").trim(),
  pickupLocation: String(process.env.DELHIVERY_PICKUP_LOCATION || "").trim(),
  sellerName: String(process.env.DELHIVERY_SELLER_NAME || "").trim(),
  sellerAddress: String(process.env.DELHIVERY_SELLER_ADDRESS || "").trim(),
  sellerGstTin: String(process.env.DELHIVERY_SELLER_GST_TIN || "").trim(),
  originPin: String(process.env.DELHIVERY_ORIGIN_PIN || "").trim(),
  pickupTime: String(process.env.DELHIVERY_PICKUP_TIME || "11:00:00").trim(),
  defaultHsnCode: String(process.env.DELHIVERY_DEFAULT_HSN_CODE || "7117").trim(),
  defaultWeightGrams: Number(process.env.DELHIVERY_DEFAULT_WEIGHT_GRAMS || 500),
  defaultLengthCm: Number(process.env.DELHIVERY_DEFAULT_LENGTH_CM || 20),
  defaultWidthCm: Number(process.env.DELHIVERY_DEFAULT_WIDTH_CM || 15),
  defaultHeightCm: Number(process.env.DELHIVERY_DEFAULT_HEIGHT_CM || 5),
});

export const isDelhiveryConfigured = () => {
  const current = config();
  return Boolean(current.token && current.client && current.pickupLocation && current.sellerName && current.sellerAddress && current.sellerGstTin);
};

export const isDelhiveryPickupConfigured = () => {
  const current = config();
  return Boolean(current.token && current.pickupLocation);
};

const safeJson = async (response: Response) => {
  const text = await response.text();
  try {
    return { value: JSON.parse(text) as unknown, text };
  } catch {
    return { value: null, text };
  }
};

const delhiveryError = (message: string, status?: number) => {
  const error = new Error(message);
  error.name = "DelhiveryError";
  if (status) Object.assign(error, { status });
  return error;
};

const digits = (value: string) => value.replace(/\D/g, "");
const normalizePhone = (value: string) => {
  const phone = digits(value);
  return phone.length > 10 ? phone.slice(-10) : phone;
};
const extractPincode = (value: string) => value.match(/\b[1-9][0-9]{5}\b/)?.[0] || "";
const asAmount = (value: string) => {
  const amount = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
};
const trackingUrl = (waybill: string) => `https://www.delhivery.com/tracking?uniqueIdentifier=${encodeURIComponent(waybill)}`;

const parseAddress = (order: DelhiveryOrder): DelhiveryAddress => {
  const address = String(order.address || "").trim();
  const pincode = extractPincode(address);
  if (!address || !pincode) throw delhiveryError("The delivery address does not contain a valid 6-digit pincode.");
  const phone = normalizePhone(order.phone);
  if (phone.length < 10) throw delhiveryError("The delivery phone number is incomplete.");
  return { name: String(order.customerName || "Customer").trim().slice(0, 100), address: address.slice(0, 256), phone, pincode };
};

const getPincodeServiceability = async (pincode: string, token: string, paymentMethod: DelhiveryOrder["paymentMethod"] = "online") => {
  const response = await fetch(`${pincodeEndpoint}?filter_codes=${encodeURIComponent(pincode)}`, {
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
  });
  const { value } = await safeJson(response);
  if (!response.ok) throw delhiveryError("Delhivery pincode serviceability check failed.", response.status);
  const row = value && typeof value === "object" && Array.isArray((value as { delivery_codes?: unknown[] }).delivery_codes)
    ? (value as { delivery_codes: Array<Record<string, unknown>> }).delivery_codes[0]
    : undefined;
  const postalCodeDetails = row?.postal_code && typeof row.postal_code === "object"
    ? row.postal_code as Record<string, unknown>
    : row;
  const returnedPincode = String(
    postalCodeDetails?.pin ?? postalCodeDetails?.pincode ?? postalCodeDetails?.postal_code ?? "",
  ).trim();
  const prepaid = String(postalCodeDetails?.pre_paid ?? row?.pre_paid ?? "").toUpperCase();
  const cod = String(postalCodeDetails?.cod ?? row?.cod ?? postalCodeDetails?.cash ?? row?.cash ?? "").toUpperCase();
  const remarks = String(postalCodeDetails?.remarks ?? row?.remarks ?? "");
  if (!row || returnedPincode !== pincode) throw delhiveryError("This delivery pincode is not serviceable by Delhivery.");
  if (paymentMethod === "cod" ? cod === "N" : prepaid !== "Y") throw delhiveryError(`This delivery pincode is not serviceable for ${paymentMethod === "cod" ? "COD" : "prepaid"} shipments.`);
  if (/embargo|not serviceable|nsz/i.test(remarks)) throw delhiveryError("This delivery pincode is currently unavailable for Delhivery shipments.");
};

const shipmentWaybill = (value: unknown): string => {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = [record.waybill, record.Waybill, record.awb, record.AWB, record.tracking_number].find((item) => typeof item === "string" && item.trim());
  if (direct) return String(direct).trim();
  for (const key of ["packages", "shipments", "shipment", "data"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = shipmentWaybill(item);
        if (found) return found;
      }
    } else {
      const found = shipmentWaybill(nested);
      if (found) return found;
    }
  }
  return "";
};

const responseMessage = (value: unknown, fallback: string) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["error", "message", "remarks", "status", "rmk"]) {
      const message = responseMessage(record[key], "");
      if (message) return message;
    }
  }
  return fallback;
};

const pickupRequestId = (value: unknown): string => {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = [
    record.pickup_id,
    record.pickupId,
    record.pickup_request_id,
    record.pickup_request,
    record.PickupId,
    record.PUR,
  ].find((item) => typeof item === "string" || typeof item === "number");
  if (direct !== undefined && String(direct).trim()) return String(direct).trim();
  for (const key of ["data", "result", "pickup", "request"]) {
    const found = pickupRequestId(record[key]);
    if (found) return found;
  }
  return "";
};

const validPickupTime = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return "11:00:00";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  return hour <= 23 && minute <= 59 && second <= 59 ? value : "11:00:00";
};

const indiaDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
};

const indiaDateString = (parts: ReturnType<typeof indiaDateParts>) =>
  `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

const nextPickupDate = () => {
  const current = indiaDateParts(new Date());
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day));
  do {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
    if (weekday !== "Sat" && weekday !== "Sun") break;
  } while (true);
  return date.toISOString().slice(0, 10);
};

export const delhiveryPickupSchedule = () => ({
  pickupDate: nextPickupDate(),
  pickupTime: validPickupTime(config().pickupTime),
  currentDate: indiaDateString(indiaDateParts(new Date())),
});

export async function createDelhiveryPickupRequest(expectedPackageCount: number): Promise<DelhiveryPickupRequestResult> {
  const current = config();
  if (!isDelhiveryPickupConfigured()) throw delhiveryError("Delhivery pickup automation is not fully configured on the server.");
  const schedule = delhiveryPickupSchedule();
  const count = Math.max(1, Math.floor(Number(expectedPackageCount) || 0));
  const body = new URLSearchParams({
    pickup_time: schedule.pickupTime,
    pickup_date: schedule.pickupDate,
    pickup_location: current.pickupLocation,
    expected_package_count: String(count),
  });
  const response = await fetch(pickupRequestEndpoint, {
    method: "POST",
    headers: { Authorization: `Token ${current.token}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const { value } = await safeJson(response);
  if (!response.ok) throw delhiveryError(`Delhivery pickup request failed: ${responseMessage(value, "request rejected")}`, response.status);
  return {
    pickupId: pickupRequestId(value) || undefined,
    pickupDate: schedule.pickupDate,
    pickupTime: schedule.pickupTime,
    expectedPackageCount: count,
    status: responseMessage(value, "Scheduled"),
  };
}

export async function manifestDelhiveryShipment(order: DelhiveryOrder): Promise<DelhiveryShipmentResult> {
  const current = config();
  if (!isDelhiveryConfigured()) throw delhiveryError("Delhivery is not fully configured on the server.");
  if (!current.originPin || !/^\d{6}$/.test(current.originPin)) throw delhiveryError("The Delhivery origin pincode is not configured.");
  const consignee = parseAddress(order);
  await getPincodeServiceability(consignee.pincode, current.token, order.paymentMethod);

  const items = (order.items || []).filter((item) => Math.max(0, Number(item.quantity) || 0) > 0);
  const quantity = items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)), 0) || 1;
  const hsnCodes = items.map((item) => String(item.hsnCode || current.defaultHsnCode).trim()).filter(Boolean);
  if (!hsnCodes.length) throw delhiveryError("An HSN code is required before creating a Delhivery shipment.");
  const weight = Math.max(100, Math.round(current.defaultWeightGrams * quantity));
  const description = items.map((item) => `${item.name} x${item.quantity}`).join(", ").slice(0, 256) || "Fanzzy order";
  const payload = {
    shipments: [{
      name: consignee.name,
      add: consignee.address,
      pin: consignee.pincode,
      phone: consignee.phone,
      country: "India",
      order: order.id.replace(/^#/, "").slice(0, 50),
      payment_mode: order.paymentMethod === "cod" ? "COD" : "Pre-paid",
      products_desc: description,
      total_amount: asAmount(order.total),
      ...(order.paymentMethod === "cod" ? { cod_amount: asAmount(order.total) } : {}),
      quantity,
      weight,
      shipment_length: current.defaultLengthCm,
      shipment_width: current.defaultWidthCm,
      shipment_height: current.defaultHeightCm,
      shipping_mode: "Surface",
      seller_name: current.sellerName,
      seller_add: current.sellerAddress.slice(0, 256),
      seller_inv: order.id.replace(/^#/, "").slice(0, 50),
      seller_gst_tin: current.sellerGstTin,
      hsn_code: hsnCodes.join(","),
      return_name: current.sellerName,
      return_add: current.sellerAddress.slice(0, 256),
      return_pin: current.originPin,
      return_country: "India",
    }],
    pickup_location: { name: current.pickupLocation },
    client: current.client,
    fragile_shipment: true,
  };
  const body = new URLSearchParams({ format: "json", data: JSON.stringify(payload) });
  const response = await fetch(createEndpoint, {
    method: "POST",
    headers: { Authorization: `Token ${current.token}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const { value } = await safeJson(response);
  if (!response.ok) throw delhiveryError(`Delhivery shipment creation failed: ${responseMessage(value, "request rejected")}`, response.status);
  const waybill = shipmentWaybill(value);
  if (!waybill) throw delhiveryError(`Delhivery shipment creation failed: ${responseMessage(value, "no waybill was returned")}`);
  return { waybill, status: responseMessage(value, "Manifested"), trackingUrl: trackingUrl(waybill) };
}

const trackingScans = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((scan) => {
    const record = scan && typeof scan === "object" ? scan as Record<string, unknown> : {};
    const detail = record.ScanDetail && typeof record.ScanDetail === "object" ? record.ScanDetail as Record<string, unknown> : record;
    return {
      status: String(detail.Scan || detail.status || detail.Status || detail.Instructions || "Update").trim(),
      date: String(detail.ScanDateTime || detail.StatusDateTime || detail.date || "").trim() || undefined,
      location: String(detail.ScannedLocation || detail.location || "").trim() || undefined,
      instructions: String(detail.Instructions || detail.instruction || "").trim() || undefined,
    };
  }).filter((scan) => scan.status);
};

export async function trackDelhiveryShipment(waybill: string, refId?: string): Promise<DelhiveryTrackingResult> {
  const current = config();
  if (!current.token) throw delhiveryError("Delhivery is not configured on the server.");
  const params = new URLSearchParams({ waybill: waybill.trim() });
  if (refId?.trim()) params.set("ref_ids", refId.trim());
  const response = await fetch(`${trackingEndpoint}?${params.toString()}`, {
    headers: { Authorization: `Token ${current.token}`, Accept: "application/json" },
  });
  const { value } = await safeJson(response);
  if (!response.ok) throw delhiveryError("Delhivery tracking request failed.", response.status);
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const shipment = Array.isArray(root.ShipmentData) ? root.ShipmentData[0] as Record<string, unknown> | undefined : undefined;
  const shipmentDetails = shipment?.Shipment && typeof shipment.Shipment === "object" ? shipment.Shipment as Record<string, unknown> : {};
  const status = shipmentDetails.Status && typeof shipmentDetails.Status === "object" ? shipmentDetails.Status as Record<string, unknown> : {};
  const scans = trackingScans(shipmentDetails.Scans || shipment?.Scans);
  return {
    waybill: waybill.trim(),
    status: String(status.Status || status.status || (typeof shipmentDetails.Status === "string" ? shipmentDetails.Status : "") || root.status || (scans[0]?.status || "Tracking available")).trim(),
    statusType: String(status.StatusType || status.status_type || "").trim() || undefined,
    statusDate: String(status.StatusDateTime || status.status_date || "").trim() || undefined,
    location: String(status.StatusLocation || status.location || shipmentDetails.Destination || shipmentDetails.Origin || "").trim() || undefined,
    scans,
  };
}

export const delhiveryTrackingUrl = trackingUrl;
