const TWO_FACTOR_BASE_URL = "https://2factor.in/API/V1";
const TWO_FACTOR_TIMEOUT_MS = 15_000;

type TwoFactorResponse = {
  ok: boolean;
  httpStatus: number;
  status: string;
  details: string;
};

export class TwoFactorSmsError extends Error {
  constructor(message: string, public readonly kind: "send" | "network") {
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

const requestProvider = async (path: string, method: "GET" | "POST", payload?: Record<string, string>): Promise<TwoFactorResponse> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new TwoFactorSmsError("2Factor SMS login is not configured.", "network");

  try {
    const response = await fetch(`${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}${path}`, {
      method,
      headers: payload
        ? { accept: "application/json", "content-type": "application/json" }
        : { accept: "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(TWO_FACTOR_TIMEOUT_MS),
    });
    return await readProviderResponse(response);
  } catch (error) {
    if (error instanceof TwoFactorSmsError) throw error;
    throw new TwoFactorSmsError("2Factor SMS service could not be reached.", "network");
  }
};

export const sendTwoFactorOtp = async (phone: string, code: string) => {
  // Use 2Factor's dedicated OTP endpoint so the provider generates the
  // approved OTP message instead of treating this as a bulk SMS request.
  const result = await requestProvider(`/SMS/${encodeURIComponent(phone)}/${encodeURIComponent(code)}`, "POST");
  if (!result.ok || result.status !== "success" || !result.details) {
    throw new TwoFactorSmsError(result.details || "2Factor could not send the SMS code.", "send");
  }
  return result.details;
};

export const sendTwoFactorVoiceOtp = async (phone: string, code: string) => {
  const voicePhone = phone.startsWith("91") ? phone.slice(2) : phone;
  const result = await requestProvider(`/VOICE/${encodeURIComponent(voicePhone)}/${encodeURIComponent(code)}`, "GET");
  if (!result.ok || result.status !== "success" || !result.details) {
    throw new TwoFactorSmsError(result.details || "2Factor could not place the voice OTP call.", "send");
  }
  return result.details;
};
