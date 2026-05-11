-- Track when each user last read each request, for unread badges
CREATE TABLE public.request_reads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  user_id UUID NOT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (request_id, user_id)
);

ALTER TABLE public.request_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own reads"
  ON public.request_reads
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own reads"
  ON public.request_reads
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_request(request_id, auth.uid()));

CREATE POLICY "Users update own reads"
  ON public.request_reads
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_request_reads_user ON public.request_reads(user_id);
CREATE INDEX idx_request_reads_request ON public.request_reads(request_id);

-- Enable realtime for messages and requests
ALTER TABLE public.request_messages REPLICA IDENTITY FULL;
ALTER TABLE public.requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.request_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.requests;