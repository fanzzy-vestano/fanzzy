import type { NextConfig } from "next";

// fanzzy.in is served from the domain root. Keeping the app root-relative is
// important for both the hosted worker and the custom-domain static fallback.
const nextConfig: NextConfig = {
  output: process.env.GITHUB_PAGES === "true" ? "export" : undefined,
  basePath: undefined,
  assetPrefix: undefined,
  trailingSlash: process.env.GITHUB_PAGES === "true",
};

export default nextConfig;
