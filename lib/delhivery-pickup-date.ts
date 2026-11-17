export const pickupDateRange = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return { min: today, max: end.toISOString().slice(0, 10) };
};

export const selectedPickupSchedule = (date: string, time: string, now = new Date()) => {
  const range = pickupDateRange(now);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date(NaN);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("Select a valid pickup date.");
  if (date < range.min || date > range.max) throw new Error("Choose a pickup date from today through the next 7 days (India time).");
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw new Error("Enter a valid pickup time.");
  if (date === range.min) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
    const hour = Number(parts.find(part => part.type === "hour")?.value);
    const minute = Number(parts.find(part => part.type === "minute")?.value);
    const [selectedHour, selectedMinute] = time.split(":").map(Number);
    if (selectedHour * 60 + selectedMinute <= hour * 60 + minute) throw new Error("Choose a future pickup time or a later pickup date (India time).");
  }
  return { pickupDate: date, pickupTime: time.length === 5 ? `${time}:00` : time, currentDate: range.min };
};
