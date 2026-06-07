/*
 * Channel Partner clickwrap — the terms of record for enterprise onboarding.
 *
 * Pure constants (no node-only imports) so this is safe to import on BOTH the
 * server (the accept route, which also hashes the statement) and the client
 * (the clickwrap gate, which renders it). The exact statement shown to the
 * admin is archived on acceptance (version + a server-computed sha256 of
 * PARTNER_TERMS_STATEMENT) in terms_acceptances.
 *
 * Material changes to the terms => bump PARTNER_TERMS_VERSION. A version bump
 * means existing acceptances no longer match the current version, which a
 * future re-acceptance gate can key off (Phase 2 gates on partner_status; the
 * versioned record is stored now so that re-acceptance can be added without a
 * backfill).
 */

export const PARTNER_TERMS_VERSION = "2026-06-07";

// The full legal text lives on the public terms page; the clickwrap links to
// it so it's viewable BEFORE acceptance (never pre-checked).
export const PARTNER_TERMS_URL = "/legal/contracting-terms";

// The affirmative statement the admin agrees to. This exact string is what we
// hash and archive — keep it stable for a given version.
export const PARTNER_TERMS_STATEMENT =
  "I have read and agree, on behalf of my organization, to the Relay.green " +
  "Channel Partner Commercial Terms, including the partner-granted usage " +
  "discount and its expiry, as published at " +
  PARTNER_TERMS_URL +
  " (version " +
  PARTNER_TERMS_VERSION +
  ").";
