import { isAdminSessionValid } from "../../../../lib/admin-auth";
import { issueOnlineRazorpayRefund } from "../../../../lib/online-refunds";

const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

const errorStatus = (message: string) =>
  /authentication/i.test(message) ? 401
    : /not found|could not be found/i.test(message) ? 404
      : /valid|pending|eligible|delivery|select|quantity/i.test(message) ? 400
        : 502;

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return json({ error: "Admin authentication required." }, 401);
  try {
    const body = await request.json() as { requestId?: unknown };
    const result = await issueOnlineRazorpayRefund(String(body.requestId || ""));
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the online refund.";
    return json({ error: message }, errorStatus(message));
  }
}
