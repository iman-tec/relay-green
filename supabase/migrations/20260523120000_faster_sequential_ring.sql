-- ============================================================================
-- Faster sequential matching: 90s → 25s per-engineer ring
-- ============================================================================
-- The sequential matcher (match_engineer) rings ONE engineer at a time,
-- best-match first, and advances to the next when the current offer expires.
-- The per-offer window was 90s (set in 20260520200000), so with N online
-- engineers the last one could wait up to N×90s (~9 min for 6 engineers) —
-- backwards for a "connect in seconds" product.
--
-- This cuts the window to 25s. Routing is unchanged (still best-score-first,
-- one at a time); only the time each engineer has to Accept before the offer
-- expires and the advance trigger moves on. match_engineer inserts offers
-- without specifying expires_at, so it picks up this default automatically.
--
-- Note: prompt advancement on expiry depends on the sweep — the customer's
-- matching screen calls expire_stale_offers() the moment its countdown hits 0
-- (≈1.5s poll), and the pg_cron sweep is the backstop when no client is open.
-- ============================================================================

ALTER TABLE public.engineer_match_offers
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '25 seconds');
