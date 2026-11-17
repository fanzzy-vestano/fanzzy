export function calculateCashPayment(total: number, received: string) {
  const totalPaise = Math.round((total + Number.EPSILON) * 100);
  const value = received.trim();
  const validAmount = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value);
  const [rupees = "0", paise = ""] = value.split(".");
  const parsedPaise = validAmount ? Number(rupees) * 100 + Number(paise.padEnd(2, "0")) : NaN;
  const receivedPaise = Number.isSafeInteger(parsedPaise) ? parsedPaise : null;
  const validTotal = Number.isSafeInteger(totalPaise) && totalPaise >= 0;
  const difference = validTotal && receivedPaise !== null ? receivedPaise - totalPaise : null;

  return {
    receivedPaise,
    changePaise: difference === null ? null : Math.max(0, difference),
    shortfallPaise: difference === null ? null : Math.max(0, -difference),
    canConfirm: difference !== null && difference >= 0,
  };
}

export function formatPosCurrency(value: number) {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
