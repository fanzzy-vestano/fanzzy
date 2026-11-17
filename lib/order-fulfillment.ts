type FulfillmentOrder = { id: string; fulfillmentMethod?: string };

export const isPosOrder = (order: Pick<FulfillmentOrder, "id">) =>
  /^#?FZ-POS-/i.test(order.id.trim());

// Payment method does not determine whether an order needs shipping.
export const orderNeedsDelivery = (order: FulfillmentOrder) =>
  !isPosOrder(order) && order.fulfillmentMethod !== "pickup";
