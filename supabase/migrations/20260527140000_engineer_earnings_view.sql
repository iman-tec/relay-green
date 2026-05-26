-- ============================================================================
-- Engineer earnings summary view — per-engineer rollup of sessions + minutes
-- ============================================================================
-- v1 is record-keeping only (Stripe Connect integration is out of scope —
-- payout amounts will be computed off this rollup once the per-engineer
-- rate is configurable). For now the Payouts tab in the engineer profile
-- pane shows session count + total minutes; the lifetime_earnings_cents
-- column is reserved for the future Stripe Connect wiring.
--
-- "Claimed" sessions are the right unit (not "ended") because billing
-- starts at the claim boundary in this codebase; even sessions that ended
-- early count toward the engineer's billable minutes per the post-2026-05
-- pricing rules.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.engineer_earnings_summary AS
SELECT
  gc.claimed_by                          AS engineer_user_id,
  count(*)::int                          AS total_sessions,
  count(*) FILTER (WHERE gc.status = 'ended')::int AS ended_sessions,
  coalesce(sum(gc.duration_minutes), 0)::numeric AS total_minutes,
  coalesce(sum(gc.duration_minutes) FILTER (WHERE gc.status = 'ended'), 0)::numeric AS billable_minutes,
  -- Reserved for Stripe Connect: when per-engineer rates land we'll multiply
  -- billable_minutes by the configured cents/minute here. NULL signals "not
  -- yet integrated" so the UI can render a "Setup pending" placeholder
  -- rather than a misleading $0.
  NULL::bigint                            AS lifetime_earnings_cents,
  max(gc.created_at)                     AS most_recent_session_at,
  min(gc.created_at)                     AS first_session_at
FROM public.guest_calls gc
WHERE gc.claimed_by IS NOT NULL
GROUP BY gc.claimed_by;

-- Recent sessions for the Payouts tab's per-session breakdown. The view
-- above gives the top-line stats; the engineer also wants to see the
-- individual calls that drove those numbers. We project the columns the
-- Payouts tab actually renders — id / customer / minutes / created_at /
-- status — and rely on RLS on the underlying guest_calls table to gate
-- the rows correctly (each engineer can only see their own).
CREATE OR REPLACE VIEW public.engineer_session_history AS
SELECT
  gc.id,
  gc.claimed_by   AS engineer_user_id,
  gc.guest_name,
  gc.guest_email,
  gc.duration_minutes,
  gc.status,
  gc.created_at,
  gc.assigned_at,
  gc.project_name
FROM public.guest_calls gc
WHERE gc.claimed_by IS NOT NULL;

GRANT SELECT ON public.engineer_earnings_summary TO authenticated;
GRANT SELECT ON public.engineer_session_history TO authenticated;

COMMIT;
