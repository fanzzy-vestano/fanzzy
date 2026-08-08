import { createBrowserClient } from "@supabase/ssr";

// These are publishable browser values. Environment variables still take
// precedence for local development and future deployments, while the
// checked-in fallback keeps the live storefront connected when the host does
// not inject .env.local during its build.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pdrcrkxeyqxqgpwfxqpu.supabase.co";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_OTSfS6G2tlrAGINfyY3VGA_yi_3BPAV";

export const supabase =
  supabaseUrl && supabasePublishableKey
    ? createBrowserClient(supabaseUrl, supabasePublishableKey)
    : null;
