/*
 * Single source of truth for customer-facing brand strings.
 *
 * Per O5/O5.j (Spec Decisions v1) — Relay.green operates as a fully
 * independent brand; no customer surface should reference Gateway Digital
 * or any parent. Sourced from env so a future rename can ship without
 * touching code.
 */

export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "Relay.green",
  domain: process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? "relay.green",
  email: {
    support:
      process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL ?? "support@relay.green",
    billing:
      process.env.NEXT_PUBLIC_BRAND_BILLING_EMAIL ?? "billing@relay.green",
  },
  copyright: `© ${process.env.NEXT_PUBLIC_BRAND_NAME ?? "Relay.green"}. All rights reserved.`,
  tagline: "You're building with AI. We're the humans who help you ship.",
  promise: "Click the green dot. Get a qualified engineer in 90 seconds.",
} as const;
