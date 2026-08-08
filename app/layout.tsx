import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lustre — Objects of allure",
  description: "Quietly remarkable jewellery for all your becoming.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
