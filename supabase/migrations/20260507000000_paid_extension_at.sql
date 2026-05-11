-- Tracks when a guest first paid to extend a session. Once set, the room
-- timer flips from "30 min free" countdown to a count-up since payment.
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS paid_extension_at timestamptz;
