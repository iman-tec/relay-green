ALTER TABLE public.request_messages
  DROP CONSTRAINT IF EXISTS request_messages_message_type_check;

ALTER TABLE public.request_messages
  ADD CONSTRAINT request_messages_message_type_check
  CHECK (message_type IN ('text', 'system', 'zoom_meeting'));