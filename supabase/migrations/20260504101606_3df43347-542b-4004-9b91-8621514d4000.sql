
-- Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_id uuid,
  kind text NOT NULL, -- 'assigned' | 'new_message' | 'status_change' | 'zoom_scheduled'
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_notifications_request ON public.notifications(request_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Allow notifications to be inserted by triggers (security definer functions); explicit policy not needed
-- but add an insert policy that lets the system create notifications for any user via SECURITY DEFINER paths.
-- We'll NOT add a generic insert policy to avoid clients inserting; triggers run as table owner.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Helper: insert a notification (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.create_notification(
  _user_id uuid,
  _request_id uuid,
  _kind text,
  _title text,
  _body text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, request_id, kind, title, body)
  VALUES (_user_id, _request_id, _kind, _title, _body);
END;
$$;

-- Trigger: on new message → notify the other party / assignee
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  sender_name text;
  recipients uuid[];
  rid uuid;
BEGIN
  -- Skip system messages
  IF NEW.message_type = 'system' THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.requests WHERE id = NEW.request_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT full_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;

  -- Notify builder + assigned engineer (excluding sender)
  recipients := ARRAY[]::uuid[];
  IF r.builder_id IS NOT NULL AND r.builder_id <> NEW.sender_id THEN
    recipients := array_append(recipients, r.builder_id);
  END IF;
  IF r.assigned_engineer_id IS NOT NULL AND r.assigned_engineer_id <> NEW.sender_id
     AND NOT (r.assigned_engineer_id = ANY(recipients)) THEN
    recipients := array_append(recipients, r.assigned_engineer_id);
  END IF;

  FOREACH rid IN ARRAY recipients LOOP
    PERFORM public.create_notification(
      rid,
      r.id,
      CASE WHEN NEW.message_type = 'zoom_meeting' THEN 'zoom_scheduled' ELSE 'new_message' END,
      CASE WHEN NEW.message_type = 'zoom_meeting'
           THEN COALESCE(sender_name, 'Someone') || ' scheduled a Zoom'
           ELSE COALESCE(sender_name, 'Someone') || ' replied on "' || r.title || '"'
      END,
      LEFT(NEW.body, 140)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_new_message
AFTER INSERT ON public.request_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_message();

-- Trigger: on request update → notify on assignment + status change
CREATE OR REPLACE FUNCTION public.notify_on_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Assignment changed → notify the new engineer
  IF NEW.assigned_engineer_id IS DISTINCT FROM OLD.assigned_engineer_id
     AND NEW.assigned_engineer_id IS NOT NULL THEN
    PERFORM public.create_notification(
      NEW.assigned_engineer_id,
      NEW.id,
      'assigned',
      'You were assigned to "' || NEW.title || '"',
      NULL
    );
  END IF;

  -- Status changed → notify builder (unless builder made the change is hard to know; notify builder)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.create_notification(
      NEW.builder_id,
      NEW.id,
      'status_change',
      'Status updated on "' || NEW.title || '"',
      'Now: ' || NEW.status
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_request_update
AFTER UPDATE ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.notify_on_request_update();
