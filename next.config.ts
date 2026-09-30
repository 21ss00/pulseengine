import type { NextConfig } from "next";

// Set at build time for GitHub Pages project sites (served under /<repo>/),
// e.g. NEXT_PUBLIC_BASE_PATH=/pulseengine. Left unset, the app behaves exactly
// as it does in local dev (served from the origin root).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
