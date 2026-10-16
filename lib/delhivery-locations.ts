export type DelhiveryPickupLocation = { name: string; address: string; city: string; state: string; pincode: string };

const settings = () => ({
  clientId: process.env.D1_CLIENT_ID?.trim() || "",
  secret: process.env.D1_CLIENT_SECRET?.trim() || "",
  authUrl: process.env.D1_AUTH_URL?.trim().replace(/\/$/, "") || "",
  realm: process.env.D1_REALM?.trim() || "",
  clientCms: process.env.D1_CLIENT_CMS?.trim() || "",
  mcpUrl: process.env.D1_MCP_URL?.trim() || "",
});
export const hasDelhiveryLocationIntegration = () => Object.values(settings()).every(Boolean);
let tokenCache: { key: string; token: string; expiresAt: number } | undefined;

async function accessToken() {
  const current = settings();
  const key = JSON.stringify(current);
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const response = await fetch(`${current.authUrl}/realms/${encodeURIComponent(current.realm)}/protocol/openid-connect/token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: current.clientId, client_secret: current.secret }),
  });
  if (!response.ok) throw new Error("Could not authenticate with Delhivery One. Check the integration credentials.");
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!result.access_token) throw new Error("Delhivery One did not return an access token.");
  tokenCache = { key, token: result.access_token, expiresAt: Date.now() + Math.max(0, Number(result.expires_in || 60) - 30) * 1000 };
  return result.access_token;
}

type Facility = { facility_id?: string; facility_name?: string; status?: string; blocked?: boolean; address?: Record<string, unknown> };
type LocationPage = { results?: Facility[] };

export async function fetchDelhiveryPickupLocations(): Promise<DelhiveryPickupLocation[]> {
  if (!hasDelhiveryLocationIntegration()) throw new Error("Delhivery One pickup-location integration is not configured.");
  const current = settings();
  const locations = new Map<string, DelhiveryPickupLocation>();
  let cursor = "";
  const seenCursors = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(current.mcpUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-HQ-Client-Id": current.clientCms },
      body: JSON.stringify({ jsonrpc: "2.0", id: page, method: "tools/call", params: {
        name: "list-pickup-locations", arguments: {
          search_on: ["facility_name"], search_term: "", search_type: "CONTAINS", page_size: 50, page,
          field: "created_at", direction: "DESC", op: "", value: "", range_updated_at_op: "", range_updated_at_value: "",
          filter_facility_status: ["ACTIVE"], next: cursor, previous: "",
        },
      } }),
    });
    if (response.status === 401) tokenCache = undefined;
    if (!response.ok) throw new Error("Could not fetch pickup locations from Delhivery One. Please retry.");
    const body = await response.text();
    const messages = body.trim().startsWith("{") ? [body] : body.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")).filter(Boolean);
    const rpc = messages.map(message => JSON.parse(message)).find(message => message.id === page);
    if (!rpc || rpc.error || rpc.result?.isError) throw new Error("Delhivery One could not list pickup locations. Please check integration access.");
    const text = rpc.result?.content?.find((item: { type: string }) => item.type === "text")?.text;
    const result = (rpc.result?.structuredContent || (text ? JSON.parse(text) : null)) as LocationPage | null;
    if (!Array.isArray(result?.results)) throw new Error("Delhivery One returned an invalid pickup-location response.");
    for (const facility of result.results) {
      if (facility.status !== "ACTIVE" || facility.blocked || !facility.facility_name?.trim()) continue;
      const address = facility.address || {};
      const value = (key: string) => String(address[key] || "").trim();
      const name = facility.facility_name.trim();
      locations.set(name, { name, address: [value("address_line1"), value("address_line2")].filter(Boolean).join(", "), city: value("city"), state: value("state"), pincode: value("pin_code") });
    }
    if (result.results.length < 50) return [...locations.values()];
    cursor = result.results.at(-1)?.facility_id || "";
    if (!cursor || seenCursors.has(cursor)) throw new Error("Delhivery One pickup-location pagination could not complete. Please retry.");
    seenCursors.add(cursor);
  }
  throw new Error("Too many Delhivery pickup-location pages. Please contact support.");
}
