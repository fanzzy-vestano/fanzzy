import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.GITHUB_PAGES === "true" ? "export" : undefined,
  basePath: process.env.GITHUB_PAGES === "true" ? "/fanzzy" : undefined,
  assetPrefix: process.env.GITHUB_PAGES === "true" ? "/fanzzy/" : undefined,
  trailingSlash: process.env.GITHUB_PAGES === "true",
};

export default nextConfig;
