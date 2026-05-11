-- Storage bucket for request attachments (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('request-attachments', 'request-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Add attachment columns to request_messages
ALTER TABLE public.request_messages
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_mime text,
  ADD COLUMN IF NOT EXISTS attachment_size integer;

-- Storage RLS: files are stored under <request_id>/<uuid>-<filename>
-- Read: anyone who can view the request can read its files
CREATE POLICY "View request attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'request-attachments'
  AND public.can_view_request(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

-- Upload: must be able to view the target request
CREATE POLICY "Upload request attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'request-attachments'
  AND public.can_view_request(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

-- Delete: only the uploader (owner) can delete their file
CREATE POLICY "Delete own request attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'request-attachments'
  AND owner = auth.uid()
);
