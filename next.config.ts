import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a stray package-lock.json one directory up
  // (e.g. in a Claude Code worktree parent) doesn't fool Next/Turbopack
  // into picking the wrong dir and serving 404s for every app/* route.
  // "." resolves relative to this file's location.
  turbopack: {
    root: ".",
  },
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
  // The Zoom Meeting SDK (Component View) uses singleton state on `window`.
  // StrictMode's intentional double-invoke of effects causes the SDK to
  // see two concurrent `init()` calls and rejects the second with errorCode
  // 3000 ("Already has other meetings in progress."). Disabling it removes
  // that dev-only artifact; production has never run in StrictMode anyway.
  reactStrictMode: false,
};

export default nextConfig;
