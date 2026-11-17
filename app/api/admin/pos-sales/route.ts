import { isAdminSessionValid } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  if (!isAdminSessionValid(request)) return Response.json({ error: "Admin authentication required." }, { status: 401 });
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  // Never fall back to a public browser key for this privileged transaction.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return Response.json({ error: "Atomic POS saving is not configured. No sale was submitted." }, { status: 503 });
  let order: unknown;
  try {
    const body = await request.json() as { order?: unknown };
    order = body.order;
    if (!order || typeof order !== "object" || Array.isArray(order) || JSON.stringify(order).length > 1_000_000) throw new Error();
  } catch {
    return Response.json({ error: "Invalid POS sale." }, { status: 400 });
  }
  try {
    const response = await fetch(`${url}/rest/v1/rpc/commit_pos_sale`, {
      method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_order: order }),
    });
    const result = await response.json() as { code?: string; message?: string; order?: { id?: string } };
    if (!response.ok) {
      const known = result.code === "23505" || result.code === "P0001" || result.code?.startsWith("22");
      return Response.json({ error: known ? result.message || "Sale validation failed." : "Could not confirm the POS sale. Retry the same sale reference.", code: result.code }, { status: known ? 409 : 502 });
    }
    if (!result.order?.id) throw new Error("Invalid transaction response");
    return Response.json(result);
  } catch {
    return Response.json({ error: "Sale confirmation is uncertain. Retry the same sale reference; do not create a new sale." }, { status: 502 });
  }
}
