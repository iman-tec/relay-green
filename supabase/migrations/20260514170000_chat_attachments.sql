-- Live-chat attachments (documents + images).
--
-- A guest_messages row can carry text, attachments, or both. Attachments
-- live in a child table so a single message can bundle multiple files;
-- images are capped at 3 per message via a trigger. Files themselves are
-- stored in a private "chat-attachments" bucket scoped per session.

-- ── Child table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_message_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES public.guest_messages(id) ON DELETE CASCADE,
  path         text NOT NULL,
  name         text NOT NULL,
  mime         text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  kind         text NOT NULL CHECK (kind IN ('image', 'document')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_message_attachments_message
  ON public.guest_message_attachments (message_id);

-- ── Loosen guest_messages.body ─────────────────────────────────────────────
-- An attachment-only message has no body text. The non-empty-bubble
-- invariant ("at least body or attachment") is enforced client-side; the
-- DB stays permissive.
ALTER TABLE public.guest_messages
  ALTER COLUMN body DROP NOT NULL;

-- ── Trigger: cap images at 3 per message ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_attachment_image_cap()
RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'image' AND (
    SELECT count(*)
    FROM public.guest_message_attachments
    WHERE message_id = NEW.message_id AND kind = 'image'
  ) > 3 THEN
    RAISE EXCEPTION 'A message can carry at most 3 images';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guest_message_attachments_image_cap
  ON public.guest_message_attachments;
CREATE TRIGGER guest_message_attachments_image_cap
  AFTER INSERT ON public.guest_message_attachments
  FOR EACH ROW EXECUTE FUNCTION public.guard_attachment_image_cap();

-- ── RLS on the child table ────────────────────────────────────────────────
-- Read/write piggy-back on guest_messages: if the caller can see the
-- parent row, they can see (and append) attachments to it.
ALTER TABLE public.guest_message_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'guest_message_attachments'
      AND policyname = 'gma_select_via_parent'
  ) THEN
    EXECUTE 'CREATE POLICY gma_select_via_parent
      ON public.guest_message_attachments FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.guest_messages gm
        WHERE gm.id = guest_message_attachments.message_id
      ))';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'guest_message_attachments'
      AND policyname = 'gma_insert_via_parent'
  ) THEN
    EXECUTE 'CREATE POLICY gma_insert_via_parent
      ON public.guest_message_attachments FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.guest_messages gm
        WHERE gm.id = guest_message_attachments.message_id
      ))';
  END IF;
END $$;

-- ── Storage bucket: chat-attachments ───────────────────────────────────────
-- Private; 50 MB cap; documents + images only. The bucket-level limits
-- are server-enforced even if the client tries to bypass.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Storage RLS helpers ────────────────────────────────────────────────────
-- A user may touch chat-attachments objects under <session_id>/... if they
-- are the customer on that session, the assigned engineer, or hold one of
-- the supervisor-tier roles.
CREATE OR REPLACE FUNCTION public.can_access_chat_session(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = _session_id
      AND (gc.customer_user_id = _user_id OR gc.claimed_by = _user_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('pod_lead', 'ops_manager', 'admin', 'enterprise_admin', 'super_admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_chat_session(uuid, uuid) TO authenticated;

-- ── Storage RLS policies for the bucket ────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'View chat attachments'
  ) THEN
    EXECUTE 'CREATE POLICY "View chat attachments"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = ''chat-attachments''
        AND public.can_access_chat_session(
          ((storage.foldername(name))[1])::uuid,
          auth.uid()
        )
      )';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Upload chat attachments'
  ) THEN
    EXECUTE 'CREATE POLICY "Upload chat attachments"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = ''chat-attachments''
        AND public.can_access_chat_session(
          ((storage.foldername(name))[1])::uuid,
          auth.uid()
        )
      )';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Delete own chat attachments'
  ) THEN
    EXECUTE 'CREATE POLICY "Delete own chat attachments"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = ''chat-attachments''
        AND owner = auth.uid()
      )';
  END IF;
END $$;
