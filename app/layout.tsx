import type { Metadata } from "next";
import "./globals.css";
import "./brand-polish.css";

export const metadata: Metadata = {
  title: "Fanzzy",
  description: "Quietly remarkable jewellery for all your becoming.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}



