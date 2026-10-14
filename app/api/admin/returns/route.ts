import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { getWalkInReturnOrder, processWalkInReturn } from "../../../../lib/walk-in-returns";

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

const errorStatus = (message: string) =>
  /authentication/i.test(message) ? 401
    : /not found|could not be found/i.test(message) ? 404
      : /quantity|reason|description|refund|cash|upi|valid/i.test(message) ? 400
        : 502;

export async function GET(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  const orderId = new URL(request.url).searchParams.get("orderId") || "";
  try {
    const summary = await getWalkInReturnOrder(orderId);
    if (!summary) return json({ error: "Order could not be found." }, 404);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load return order.";
    return json({ error: message }, errorStatus(message));
  }
}

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const record = await processWalkInReturn(body);
    const summary = await getWalkInReturnOrder(record.orderId);
    return json({ record, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process the return.";
    return json({ error: message }, errorStatus(message));
  }
}

