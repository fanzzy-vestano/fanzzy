import { clearCustomerAuthCookies } from "../../../../lib/customer-sms-auth";

export async function POST() {
  const headers = new Headers({ "content-type": "application/json" });
  clearCustomerAuthCookies().forEach((value) => headers.append("set-cookie", value));
  return new Response(JSON.stringify({ signedOut: true }), {
    headers,
  });
}
