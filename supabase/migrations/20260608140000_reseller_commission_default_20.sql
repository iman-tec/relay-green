-- ============================================================================
-- Channel Partner commission defaults to 20%.
-- ============================================================================
-- A new reseller's commission (Relay's wholesale discount to the partner, and
-- the ceiling on the passthrough they can grant clients) now defaults to 20%
-- instead of 0. Super-admin can still set/override it at creation and edit it
-- after via PATCH /api/admin/resellers/[id]. Additive (column default only);
-- existing rows are untouched.
-- ============================================================================

BEGIN;

ALTER TABLE public.resellers ALTER COLUMN commission SET DEFAULT 20;

COMMIT;
