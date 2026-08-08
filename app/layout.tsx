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
  return <html lang="en"><body>{children}</body></html>;
}



