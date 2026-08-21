export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const bridge = await fetch("http://127.0.0.1:3002/print", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: await request.text(),
    });
    return new Response(await bridge.text(), {
      status: bridge.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Local printer bridge is unavailable." }, { status: 503 });
  }
}
