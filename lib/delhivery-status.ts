const normalizeStatus = (status?: string) => (status || "").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();

export const hasDelhiveryShipmentShipped = (status?: string) => {
  // "Not Picked" is a pre-pickup status, not evidence of collection.
  const positiveStatus = normalizeStatus(status).replace(/\bnot\s*picked(?:\s*up)?\b/gi, "");
  return /\bpicked(?:\s*up)?\b|\bdispatched\b|\bin\s*transit\b|\bout for delivery\b|\bshipped\b|\bdelivered\b/i.test(positiveStatus);
};

export const isDelhiveryPickupRetryBlocked = (status?: string) =>
  hasDelhiveryShipmentShipped(status) || /\bcancelled\b|\bcanceled\b/i.test(normalizeStatus(status));
