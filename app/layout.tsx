import type { Metadata } from "next";
import "./globals.css";
import "./brand-polish.css";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Fanzzy",
  description: "Quietly remarkable jewellery for all your becoming.",
  icons: { icon: `${siteBasePath}/favicon.svg`, shortcut: `${siteBasePath}/favicon.svg` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The active customer-login rollout is SMS-only. This guards the public UI
  // against exposing the legacy voice-call fallback while older client markup
  // is replaced by the SMS-only login flow.
  return <html lang="en"><body><style>{".otp-fallback-actions button + button { display: none !important; }"}</style>{children}</body></html>;
}



