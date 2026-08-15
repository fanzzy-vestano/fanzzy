const TWO_FACTOR_BASE_URL = "https://2factor.in/API/V1";
const TWO_FACTOR_TEMPLATE_NAME = "Fanzzy Login OTP";
const TWO_FACTOR_TIMEOUT_MS = 15_000;

type TwoFactorResponse = {
  ok: boolean;
  httpStatus: number;
  status: string;
  details: string;
};

export class TwoFactorSmsError extends Error {
  constructor(message: string, public readonly kind: "send" | "verify" | "network") {
    super(message);
    this.name = "TwoFactorSmsError";
  }
}

const getApiKey = () => process.env.TWO_FACTOR_API_KEY?.trim() || "";

const readProviderResponse = async (response: Response): Promise<TwoFactorResponse> => {
  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new TwoFactorSmsError("2Factor returned an invalid response.", "network");
  }

  return {
    ok: response.ok,
    httpStatus: response.status,
    status: String(result.Status ?? result.status ?? "").trim().toLowerCase(),
    details: String(result.Details ?? result.details ?? result.Message ?? result.message ?? result.Errors ?? result.errors ?? "").trim(),
  };
};

const requestProvider = async (path: string, method: "GET" | "POST"): Promise<TwoFactorResponse> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new TwoFactorSmsError("2Factor SMS login is not configured.", "network");

  try {
    const response = await fetch(`${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}${path}`, {
      method,
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TWO_FACTOR_TIMEOUT_MS),
    });
    return await readProviderResponse(response);
  } catch (error) {
    if (error instanceof TwoFactorSmsError) throw error;
    throw new TwoFactorSmsError("2Factor SMS service could not be reached.", "network");
  }
};

export const sendTwoFactorOtp = async (phone: string) => {
  const result = await requestProvider(`/SMS/${encodeURIComponent(phone)}/AUTOGEN/${encodeURIComponent(TWO_FACTOR_TEMPLATE_NAME)}`, "POST");
  if (!result.ok || result.status !== "success" || !result.details) {
    throw new TwoFactorSmsError(result.details || "2Factor could not send the SMS code.", "send");
  }
  return result.details;
};

export const verifyTwoFactorOtp = async (sessionId: string, code: string) => {
  const result = await requestProvider(`/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(code)}`, "GET");
  return result;
};

export const twoFactorTemplateName = TWO_FACTOR_TEMPLATE_NAME;
