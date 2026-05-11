import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server runs on https://10.0.1.207:3000 only — both schemes whitelisted
  // (the http variants stay so a stray http:// link doesn't 403 the asset
  // even though every page redirects to https).
  allowedDevOrigins: [
    "10.0.1.207",
    "10.0.1.207:3000",
    "10.0.1.207:3001",
    "https://10.0.1.207",
    "https://10.0.1.207:3000",
    "https://10.0.1.207:3001",
  ],
};

export default nextConfig;
