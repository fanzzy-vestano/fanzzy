import { createBrowserClient } from "@supabase/ssr";
import { assertLocalTestBrowserSafety, isLocalTestEnvironment } from "../runtime-safety";

// These are publishable browser values. Environment variables still take
// precedence for local development and future deployments, while the
// checked-in fallback keeps the live storefront connected when the host does
// not inject .env.local during its build.
assertLocalTestBrowserSafety(process.env);
const localTest = isLocalTestEnvironment(process.env);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || (localTest ? "" : "https://pdrcrkxeyqxqgpwfxqpu.supabase.co");
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || (localTest ? "" : "sb_publishable_OTSfS6G2tlrAGINfyY3VGA_yi_3BPAV");

export const supabase =
  supabaseUrl && supabasePublishableKey
    ? createBrowserClient(supabaseUrl, supabasePublishableKey)
    : null;

export async function isGoogleProviderEnabled(): Promise<boolean | null> {
  if (!supabaseUrl || !supabasePublishableKey) return null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    });
    if (!response.ok) return null;
    const settings = await response.json() as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    return null;
  }
}
