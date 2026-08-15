const TWO_FACTOR_BASE_URL = "https://2factor.in/API/V1";
const TWO_FACTOR_TIMEOUT_MS = 15_000;

type TwoFactorVoiceResponse = {
  ok: boolean;
  status: string;
  details: string;
};

export class TwoFactorVoiceError extends Error {
  constructor(message: string, public readonly kind: "send" | "network") {
    super(message);
    this.name = "TwoFactorVoiceError";
  }
}

const readProviderResponse = async (response: Response): Promise<TwoFactorVoiceResponse> => {
  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new TwoFactorVoiceError("2Factor returned an invalid voice response.", "network");
  }
  return {
    ok: response.ok,
    status: String(result.Status ?? result.status ?? "").trim().toLowerCase(),
    details: String(result.Details ?? result.details ?? result.Message ?? result.message ?? result.Errors ?? result.errors ?? "").trim(),
  };
};

export const sendTwoFactorVoiceOtp = async (phone: string, code: string) => {
  const apiKey = process.env.TWO_FACTOR_API_KEY?.trim() || "";
  if (!apiKey) throw new TwoFactorVoiceError("2Factor voice login is not configured.", "network");
  try {
    const url = `${TWO_FACTOR_BASE_URL}/${encodeURIComponent(apiKey)}/VOICE/${encodeURIComponent(phone)}/${encodeURIComponent(code)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TWO_FACTOR_TIMEOUT_MS),
    });
    const result = await readProviderResponse(response);
    if (!result.ok || result.status !== "success" || !result.details) {
      throw new TwoFactorVoiceError(result.details || "2Factor could not start the voice call.", "send");
    }
    return result.details;
  } catch (error) {
    if (error instanceof TwoFactorVoiceError) throw error;
    throw new TwoFactorVoiceError("2Factor voice service could not be reached.", "network");
  }
};
