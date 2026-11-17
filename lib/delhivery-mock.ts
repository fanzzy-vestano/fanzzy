import type { DelhiveryOrder, DelhiveryPickupRequestResult, DelhiveryShipmentResult, DelhiveryTrackingResult } from "./delhivery";

type MockShipment = {
  orderId: string;
  weightGrams: number;
  paymentMode: "COD" | "Pre-paid";
  codAmount?: number;
  pickupLocation: string;
  stage: number;
  createdAt: string;
};

const stages = ["Ready to Ship", "Scheduled for pickup", "In Transit", "Out for delivery", "Delivered"];
const mockShipments = new Map<string, MockShipment>();
const amount = (value: string) => Number(String(value || "").replace(/[^0-9.-]/g, "")) || 0;

export const createMockDelhiveryShipment = (order: DelhiveryOrder, weightGrams: number, pickupLocation: string): DelhiveryShipmentResult => {
  const waybill = `TEST-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  mockShipments.set(waybill, {
    orderId: order.id,
    weightGrams,
    paymentMode: order.paymentMethod === "cod" ? "COD" : "Pre-paid",
    ...(order.paymentMethod === "cod" ? { codAmount: amount(order.total) } : {}),
    pickupLocation,
    stage: 0,
    createdAt: new Date().toISOString(),
  });
  return { waybill, status: stages[0], trackingUrl: `/api/test/delhivery/${encodeURIComponent(waybill)}` };
};

export const createMockDelhiveryPickup = (expectedPackageCount: number, pickupTime: string): DelhiveryPickupRequestResult => ({
  pickupId: `TEST-PICKUP-${Date.now()}`,
  pickupDate: new Date().toISOString().slice(0, 10),
  pickupTime,
  expectedPackageCount: Math.max(1, expectedPackageCount),
  status: "Scheduled",
});

export const trackMockDelhiveryShipment = (waybill: string): DelhiveryTrackingResult => {
  const shipment = mockShipments.get(waybill);
  if (!shipment) throw new Error("Mock Delhivery waybill was not found.");
  const status = stages[shipment.stage] || stages[0];
  return {
    waybill,
    status,
    statusType: shipment.stage === stages.length - 1 ? "DL" : "UD",
    statusDate: new Date().toISOString(),
    location: shipment.pickupLocation,
    scans: stages.slice(0, shipment.stage + 1).reverse().map((scanStatus, index) => ({
      status: scanStatus,
      date: new Date(Date.now() - index * 60_000).toISOString(),
      location: shipment.pickupLocation,
      instructions: scanStatus,
    })),
  };
};

export const advanceMockDelhiveryShipment = (waybill: string) => {
  const shipment = mockShipments.get(waybill);
  if (!shipment) throw new Error("Mock Delhivery waybill was not found.");
  shipment.stage = Math.min(stages.length - 1, shipment.stage + 1);
  return trackMockDelhiveryShipment(waybill);
};

export const inspectMockDelhiveryShipment = (waybill: string) => {
  const shipment = mockShipments.get(waybill);
  if (!shipment) throw new Error("Mock Delhivery waybill was not found.");
  return { ...shipment, waybill, tracking: trackMockDelhiveryShipment(waybill) };
};
