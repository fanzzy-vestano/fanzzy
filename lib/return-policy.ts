export type OnlineReturnOrder = {
  status?: string;
  posSale?: boolean;
  deliveredAt?: string;
  delhiveryLiveStatus?: string;
  delhiveryLiveStatusDate?: string;
  delhiveryScans?: Array<{ status?: string; date?: string }>;
};

export type OnlineReturnEligibility = {
  eligible: boolean;
  message: string;
  deliveredAt: string | null;
  deadline: string | null;
};

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

export const getOnlineReturnEligibility = (order: OnlineReturnOrder, at = new Date()): OnlineReturnEligibility => {
  if (order.posSale) return { eligible: false, message: "POS returns are handled at the counter.", deliveredAt: null, deadline: null };
  if (order.status !== "Delivered") return { eligible: false, message: "Return requests are available after delivery.", deliveredAt: null, deadline: null };

  const deliveredScan = order.delhiveryScans?.find((scan) => /delivered/i.test(scan.status || "") && scan.date);
  const carrierDate = /delivered/i.test(order.delhiveryLiveStatus || "") ? order.delhiveryLiveStatusDate : undefined;
  const deliveryDate = order.deliveredAt || deliveredScan?.date || carrierDate;
  const deliveredAtMs = Date.parse(deliveryDate || "");
  if (!Number.isFinite(deliveredAtMs)) return {
    eligible: false,
    message: "The delivery date is unavailable. Please contact support about this return.",
    deliveredAt: null,
    deadline: null,
  };

  const deadlineMs = deliveredAtMs + sevenDaysMs;
  const requestedAtMs = at.getTime();
  const eligible = Number.isFinite(requestedAtMs) && requestedAtMs >= deliveredAtMs && requestedAtMs <= deadlineMs;
  return {
    eligible,
    message: eligible ? "Return request is within 7 days of delivery." : "The 7-day return period has ended for this order.",
    deliveredAt: new Date(deliveredAtMs).toISOString(),
    deadline: new Date(deadlineMs).toISOString(),
  };
};
