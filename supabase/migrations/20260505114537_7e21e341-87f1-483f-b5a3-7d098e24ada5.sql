ALTER TABLE public.guest_threads
  ADD COLUMN IF NOT EXISTS free_minutes_used numeric NOT NULL DEFAULT 0;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS free_minutes_used numeric NOT NULL DEFAULT 0;