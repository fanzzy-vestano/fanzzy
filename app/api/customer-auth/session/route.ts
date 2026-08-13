import { getCustomerSession } from "../../../../lib/customer-sms-auth";

export async function GET(request: Request) {
  return new Response(JSON.stringify({ user: getCustomerSession(request) }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
