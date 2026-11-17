import { advanceMockDelhiveryShipment, inspectMockDelhiveryShipment } from "../../../../../lib/delhivery-mock";
import { isLocalTestEnvironment } from "../../../../../lib/runtime-safety";

const unavailable = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(_request: Request, context: { params: Promise<{ waybill: string }> }) {
  if (!isLocalTestEnvironment(process.env) || process.env.DELHIVERY_MODE !== "mock") return unavailable();
  try {
    return Response.json({ shipment: inspectMockDelhiveryShipment((await context.params).waybill) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mock shipment was not found." }, { status: 404 });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ waybill: string }> }) {
  if (!isLocalTestEnvironment(process.env) || process.env.DELHIVERY_MODE !== "mock") return unavailable();
  try {
    return Response.json({ tracking: advanceMockDelhiveryShipment((await context.params).waybill) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mock shipment was not found." }, { status: 404 });
  }
}
