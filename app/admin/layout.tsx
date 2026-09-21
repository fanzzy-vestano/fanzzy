import type { Metadata } from "next";
import { AdminInstallProvider } from "./admin-install";
import "./admin-install.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Fanzzy Admin",
  applicationName: "Fanzzy Admin",
  description: "Fanzzy administration: products, supplier bills, purchases and orders.",
  manifest: `${basePath}/admin.webmanifest`,
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Fanzzy Admin" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminInstallProvider>{children}</AdminInstallProvider>;
}
