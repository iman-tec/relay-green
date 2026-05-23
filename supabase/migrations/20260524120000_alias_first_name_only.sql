-- ============================================================================
-- Engineer aliases: single first name only (drop the last name)
-- ============================================================================
-- 20260523130000 generated two-word "First Last" aliases to satisfy Zoom's
-- first+last registrant requirement. Per product feedback we want something
-- simpler — just a first name ("Leo", "Mia"). The Zoom registrant helper
-- (mint-zoom-for-session/addRegistrant) already tolerates a single-word name
-- by using "." as the placeholder last_name, so a one-word alias is safe.
--
-- Redefines assign_engineer_alias to pick ONE first name (retry until unused;
-- fall back to a numbered variant only if the whole pool is exhausted), then
-- converts any existing two-word aliases to a fresh single-word one.
-- accept_match / supervisor_assign_engineer are unchanged — they just call
-- this function.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_engineer_alias(_user uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Short, globally-pronounceable first names. Hand-picked so they're always
  -- sayable and never accidentally offensive.
  _first text[] := ARRAY[
    'Leo','Mia','Kai','Sam','Ana','Max','Noa','Theo','Nina','Omar',
    'Lena','Finn','Tara','Maya','Cole','Ivy','Jude','Sky','Zoe','Ravi',
    'Ada','Eli','Faye','Hana','Jai','Kira','Luca','Mira','Neel','Otto',
    'Pia','Remy','Sana','Tess','Uma','Vik','Wren','Yara','Zane','Arlo',
    'Bree','Cody','Dara','Esha','Gia','Hugo','Inez','Milo','Nora','Orin',
    'Rhea','Soren','Vera','Wade','Zara'
  ];
  _existing  text;
  _candidate text;
  _try       int := 0;
BEGIN
  SELECT display_alias INTO _existing FROM engineer_profiles WHERE user_id = _user;
  IF _existing IS NOT NULL AND _existing <> '' THEN
    RETURN _existing;
  END IF;

  -- Pick a first name and retry until it's unused.
  WHILE _candidate IS NULL AND _try < 100 LOOP
    _candidate := _first[1 + floor(random() * array_length(_first, 1))::int];
    IF EXISTS (SELECT 1 FROM engineer_profiles WHERE display_alias = _candidate) THEN
      _candidate := NULL;
    END IF;
    _try := _try + 1;
  END LOOP;

  -- Pool exhausted (more concurrent engineers than names): keep it human with
  -- a small numeric suffix rather than a UUID blob.
  IF _candidate IS NULL THEN
    _candidate := _first[1 + floor(random() * array_length(_first, 1))::int]
                  || (floor(random() * 90 + 10))::text;
  END IF;

  UPDATE engineer_profiles SET display_alias = _candidate, updated_at = now()
   WHERE user_id = _user;

  RETURN _candidate;
END $$;

GRANT EXECUTE ON FUNCTION public.assign_engineer_alias(uuid) TO authenticated;

-- Convert any existing two-word aliases to a fresh single-word one.
UPDATE engineer_profiles SET display_alias = NULL WHERE display_alias LIKE '% %';
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT user_id FROM engineer_profiles
     WHERE display_alias IS NULL OR display_alias = ''
  LOOP
    PERFORM public.assign_engineer_alias(r.user_id);
  END LOOP;
END $$;

COMMIT;
