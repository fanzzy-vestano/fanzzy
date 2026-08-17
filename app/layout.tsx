import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./brand-polish.css";
import "./pwa-install.css";
import PwaInstall from "./pwa-install";

const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Fanzzy",
  description: "Quietly remarkable jewellery for all your becoming.",
  applicationName: "Fanzzy",
  manifest: `${siteBasePath}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fanzzy",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: `${siteBasePath}/favicon.svg`, type: "image/svg+xml" },
      { url: `${siteBasePath}/app-icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    shortcut: `${siteBasePath}/favicon.svg`,
    apple: [{ url: `${siteBasePath}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#551a2d",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><meta name="apple-mobile-web-app-capable" content="yes" /></head><body>{children}<PwaInstall basePath={siteBasePath} /></body></html>;
}
