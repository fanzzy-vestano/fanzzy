import { md5 } from "../supabase/functions/customer-auth/md5";

const SANGAMAM_SMS_ENDPOINT = "https://fastsms.sangamamonline.in/api/sms/v1.0/send-sms";
const SANGAMAM_SMS_REQUEST_FOR = "send-sms";
const SANGAMAM_SMS_SIGNATURE_NAMESPACE = "sms@rits-v1.0";
const SANGAMAM_SMS_TIMEOUT_MS = 15_000;
const DEFAULT_SMS_HEADER = "FANZZY";
const DEFAULT_ENTITY_ID = "1201178763981946340";
const DEFAULT_TEMPLATE_ID = "1277178790132462995";

type SangamamSmsResponse = {
  status?: unknown;
  message?: unknown;
  httpStatusCode?: unknown;
  data?: { submissionId?: unknown };
};

type SangamamSmsConfiguration = {
  accessToken: string;
  accessTokenKey: string;
  smsHeader: string;
  entityId: string;
  templateId: string;
};

export class SangamamSmsError extends Error {
  constructor(message: string, public readonly kind: "send" | "network") {
    super(message);
    this.name = "SangamamSmsError";
  }
}

const getConfiguration = (): SangamamSmsConfiguration => ({
  accessToken: process.env.SANGAMAM_SMS_ACCESS_TOKEN?.trim() || "",
  accessTokenKey: process.env.SANGAMAM_SMS_ACCESS_TOKEN_KEY?.trim() || "",
  smsHeader: process.env.SANGAMAM_SMS_HEADER?.trim() || DEFAULT_SMS_HEADER,
  entityId: process.env.SANGAMAM_SMS_ENTITY_ID?.trim() || DEFAULT_ENTITY_ID,
  templateId: process.env.SANGAMAM_SMS_TEMPLATE_ID?.trim() || DEFAULT_TEMPLATE_ID,
});

export const isSangamamSmsConfigured = () => {
  const configuration = getConfiguration();
  return Boolean(configuration.accessToken && configuration.accessTokenKey);
};

const createAuthSignature = (accessToken: string, accessTokenKey: string, expire: number) => {
  const timeKey = md5(`${SANGAMAM_SMS_REQUEST_FOR}${SANGAMAM_SMS_SIGNATURE_NAMESPACE}${expire}`);
  const timeAccessTokenKey = md5(`${accessToken}${timeKey}`);
  return md5(`${timeAccessTokenKey}${accessTokenKey}`);
};

const otpMessage = (code: string) =>
  `${code} is your OTP to verify phone number at Fanzzy. Please do not share OTP with anyone.`;

const localIndianNumber = (phone: string) => phone.startsWith("91") ? phone.slice(2) : phone;

export const sendSangamamOtp = async (phone: string, code: string) => {
  const configuration = getConfiguration();
  if (!configuration.accessToken || !configuration.accessTokenKey) {
    throw new SangamamSmsError("Sangamam FastSMS login is not configured.", "network");
  }

  const expire = Math.floor(Date.now() / 1000) + 60;
  const authSignature = createAuthSignature(configuration.accessToken, configuration.accessTokenKey, expire);

  let response: Response;
  try {
    response = await fetch(SANGAMAM_SMS_ENDPOINT, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: configuration.accessToken,
        expire,
        authSignature,
        route: "transactional",
        smsHeader: configuration.smsHeader,
        messageContent: otpMessage(code),
        recipients: [localIndianNumber(phone)],
        contentType: "text",
        entityId: configuration.entityId,
        templateId: configuration.templateId,
        removeDuplicateNumbers: 1,
      }),
      signal: AbortSignal.timeout(SANGAMAM_SMS_TIMEOUT_MS),
    });
  } catch {
    throw new SangamamSmsError("Sangamam FastSMS service could not be reached.", "network");
  }

  const raw = await response.text();
  let result: SangamamSmsResponse = {};
  try {
    result = JSON.parse(raw) as SangamamSmsResponse;
  } catch {
    throw new SangamamSmsError("Sangamam FastSMS returned an invalid response.", "send");
  }

  const status = String(result.status || "").trim().toLowerCase();
  const providerStatus = Number(result.httpStatusCode || response.status);
  const message = String(result.message || "").trim();
  if (!response.ok || status !== "success" || providerStatus !== 200) {
    throw new SangamamSmsError(message || "Sangamam FastSMS could not send the SMS code.", "send");
  }

  return String(result.data?.submissionId || "sent");
};
