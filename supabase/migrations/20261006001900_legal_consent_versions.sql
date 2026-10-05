-- Phase A legal consent and policy-version tracking.
-- Additive only: preserves existing profile/account data and ranking infrastructure.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version text,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    display_name,
    terms_version,
    terms_accepted_at,
    privacy_version,
    privacy_accepted_at
  )
  VALUES (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''),
    CASE
      WHEN new.raw_user_meta_data ->> 'terms_version' = '2026-10-06'
        THEN '2026-10-06'
      ELSE NULL
    END,
    CASE
      WHEN new.raw_user_meta_data ->> 'terms_version' = '2026-10-06'
        THEN now()
      ELSE NULL
    END,
    CASE
      WHEN new.raw_user_meta_data ->> 'privacy_version' = '2026-10-06'
        THEN '2026-10-06'
      ELSE NULL
    END,
    CASE
      WHEN new.raw_user_meta_data ->> 'privacy_version' = '2026-10-06'
        THEN now()
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_alert_preferences (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_current_legal()
RETURNS public.profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.profiles
  SET
    terms_version = '2026-10-06',
    terms_accepted_at = now(),
    privacy_version = '2026-10-06',
    privacy_accepted_at = now()
  WHERE id = (SELECT auth.uid())
  RETURNING public.profiles.*;
$$;

REVOKE ALL ON FUNCTION public.accept_current_legal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_current_legal() TO authenticated;

-- Legal-version fields are written by the trusted signup trigger or the
-- SECURITY DEFINER acceptance function, not by direct client profile updates.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_url, is_public) ON TABLE public.profiles TO authenticated;
