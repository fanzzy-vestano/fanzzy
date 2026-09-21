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
  return <html lang="en"><head>
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pdrcrkxeyqxqgpwfxqpu.supabase.co"} crossOrigin="anonymous" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,500;1,600&display=swap" />
  </head><body>{children}<PwaInstall basePath={siteBasePath} /></body></html>;
}
