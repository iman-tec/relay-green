import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a stray package-lock.json one directory up
  // (e.g. in a Claude Code worktree parent) doesn't fool Next/Turbopack
  // into picking the wrong dir and serving 404s for every app/* route.
  // "." resolves relative to this file's location.
  turbopack: {
    root: ".",
  },
  // Dev server runs on https://10.0.2.129:3000 only — both schemes whitelisted
  // (was 10.0.1.207 originally; updated for this machine's LAN IP)
  // (the http variants stay so a stray http:// link doesn't 403 the asset
  // even though every page redirects to https).
  allowedDevOrigins: [
    "10.0.2.129",
    "10.0.2.129:3000",
    "10.0.2.129:3001",
    "https://10.0.2.129",
    "https://10.0.2.129:3000",
    "https://10.0.2.129:3001",
  ],
  // The Zoom Meeting SDK (Component View) uses singleton state on `window`.
  // StrictMode's intentional double-invoke of effects causes the SDK to
  // see two concurrent `init()` calls and rejects the second with errorCode
  // 3000 ("Already has other meetings in progress."). Disabling it removes
  // that dev-only artifact; production has never run in StrictMode anyway.
  reactStrictMode: false,

  // Baseline security headers for the public marketing site.
  //
  // CSP ships in REPORT-ONLY mode below so violations surface in the
  // browser console without breaking the page. Once the report-only
  // window has been clean for a week or two, swap the header key to
  // `Content-Security-Policy` to enforce. Do NOT enforce before testing
  // — Next.js inline boot scripts, the theme-init script, the JSON-LD
  // payloads, the Spline CDN scene file, and the Vercel Analytics
  // endpoints all need to land in the allowlist below or the page goes
  // blank.
  async headers() {
    const cspDirectives = [
      // Default deny: anything not explicitly allowed elsewhere is blocked.
      "default-src 'self'",
      // Inline + eval needed for: Next 16 hydration boot script, the
      // theme-init inline script in app/layout.tsx, JSON-LD payloads,
      // and the Spline WebGL runtime (which uses eval for shader code).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      // Inline styles are unavoidable: every page uses style={{...}}
      // and many components emit <style> blocks for scroll animations.
      "style-src 'self' 'unsafe-inline'",
      // Data URIs for the SVG paper-texture overlay; blob: for the
      // Spline-rendered canvas snapshots; same-origin for our /icon,
      // /apple-icon, /opengraph-image, /twitter-image dynamic routes.
      "img-src 'self' data: blob: https://prod.spline.design",
      // next/font self-hosts Google Fonts at /_next/static/media so
      // 'self' is enough; no third-party font CDN.
      "font-src 'self' data:",
      // Vercel Analytics + Speed Insights beacons; Spline asset fetch.
      "connect-src 'self' https://prod.spline.design https://va.vercel-scripts.com https://vitals.vercel-insights.com",
      // Same-origin <iframe> only — used by the cookie-consent legal
      // preview modal (/legal/privacy-policy?embed=1 etc).
      "frame-src 'self'",
      // Prevent third-party sites from framing relay.green pages
      // (overlap with X-Frame-Options: SAMEORIGIN below).
      "frame-ancestors 'self'",
      // <video> / <audio> sources — same-origin (explainer mp4s ship
      // out of /public).
      "media-src 'self'",
      // Block plug-in content entirely.
      "object-src 'none'",
      // Lock down where forms can POST. Forms today only mailto:; the
      // base-uri restriction prevents injected <base> tags from
      // redirecting relative URLs.
      "form-action 'self'",
      "base-uri 'self'",
      // Upgrade any stray http:// asset references to https://.
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          // HSTS — force HTTPS for two years, include subdomains, allow preload.
          // Safe on Vercel which terminates TLS on every domain by default.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Block content-type sniffing.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN allows the cookie-consent legal preview iframe to
          // embed /legal/privacy-policy and /legal/terms-of-use on the
          // same origin while blocking third-party framing.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Send only origin on cross-origin navigation; full referrer
          // within same origin so internal analytics still work.
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Minimal permissions baseline. microphone/camera/display-capture
          // are allowed for same-origin only because the Zoom Video SDK's
          // in-window <CallSurface> needs them — disabling these makes
          // `navigator.mediaDevices` undefined and breaks `client.init()`
          // with `Cannot use 'in' operator to search for 'getDisplayMedia'
          // in undefined`. Everything else stays denied by default.
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(), microphone=(self), camera=(self), display-capture=(self), payment=(), usb=(), interest-cohort=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          // CSP in report-only mode. Observe browser console for
          // violations during the soak period, then swap to
          // `Content-Security-Policy` to enforce.
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspDirectives,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
