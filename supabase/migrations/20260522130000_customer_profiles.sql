-- ============================================================================
-- Customer profiles  (master-prompt §5: customer profile management)
-- ============================================================================
-- Durable, server-side home for a customer's editable profile. Until now the
-- intake wizard only persisted these signals into localStorage
-- (lib/relay/profile.ts) — see the TODO in that file. This migration gives
-- them a real table so the profile survives device changes and is readable by
-- staff for context.
--
--   customer_profiles
--     - display_name          editable name
--     - technical_expertise   read-only in the UI; mirrored from the first
--                             intake question (Q1) and never re-asked
--     - fields_of_interest    professional-background pills (Finance, …)
--     - interest_other        free text when "Other" is picked
--     - avatar_url            public URL into the `avatars` storage bucket
--
-- Storage:
--   avatars  — public bucket, 2 MB cap, JPG/PNG/WebP only. Objects live under
--              <user_id>/… so the owner-folder RLS can scope writes.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_profiles (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name         text,
  -- Stored using the same enum the intake wizard uses (lib/relay/profile.ts
  -- TechComfort). Read-only in the profile UI — set once from Q1.
  technical_expertise  text CHECK (
                         technical_expertise IS NULL
                         OR technical_expertise IN ('non_technical','semi_technical','well_experienced')
                       ),
  fields_of_interest   text[] NOT NULL DEFAULT '{}',
  interest_other       text,
  avatar_url           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Touch updated_at on every write.
CREATE OR REPLACE FUNCTION public.customer_profiles_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS customer_profiles_set_updated_at ON public.customer_profiles;
CREATE TRIGGER customer_profiles_set_updated_at
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.customer_profiles_touch();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

-- Owner manages their own row (read + insert + update + delete).
DROP POLICY IF EXISTS "Customer manages own profile" ON public.customer_profiles;
CREATE POLICY "Customer manages own profile" ON public.customer_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff (engineer up through super_admin) may read customer profiles for
-- session context — mirrors the "Staff read intakes" policy.
DROP POLICY IF EXISTS "Staff read customer profiles" ON public.customer_profiles;
CREATE POLICY "Staff read customer profiles" ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── Storage bucket: avatars ──────────────────────────────────────────────────
-- Public read (so <img src> works without a signed URL); 2 MB cap; images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,                                  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Anyone may read avatars (the bucket is public). Writes are scoped to the
-- owner's <user_id>/ folder so a customer can only touch their own avatar.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='Public read avatars'
  ) THEN
    EXECUTE 'CREATE POLICY "Public read avatars"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = ''avatars'')';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='Upload own avatar'
  ) THEN
    EXECUTE 'CREATE POLICY "Upload own avatar"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = ''avatars''
        AND (storage.foldername(name))[1] = auth.uid()::text
      )';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='Update own avatar'
  ) THEN
    EXECUTE 'CREATE POLICY "Update own avatar"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = ''avatars''
        AND (storage.foldername(name))[1] = auth.uid()::text
      )';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='Delete own avatar'
  ) THEN
    EXECUTE 'CREATE POLICY "Delete own avatar"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = ''avatars''
        AND (storage.foldername(name))[1] = auth.uid()::text
      )';
  END IF;
END $$;

COMMIT;
