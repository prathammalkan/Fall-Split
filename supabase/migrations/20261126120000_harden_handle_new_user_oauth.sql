-- ============================================================
-- Harden handle_new_user() for OAuth signups (Google, Apple, etc.)
-- Ensures null/empty emails, >60-char display names, or long username prefixes
-- never cause constraint failures on auth.users insert.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  email_prefix TEXT;
  base_username TEXT;
  final_username TEXT;
  raw_display TEXT;
  final_display TEXT;
  counter INT := 0;
BEGIN
  email_prefix := split_part(COALESCE(NEW.email, ''), '@', 1);
  base_username := lower(regexp_replace(email_prefix, '[^a-z0-9_]', '', 'g'));

  IF base_username IS NULL OR char_length(base_username) < 3 THEN
    base_username := COALESCE(base_username, '') || 'usr';
  END IF;

  -- Keep base under 20 chars so counter suffixes always stay within 30-char CHECK.
  base_username := substring(base_username, 1, 20);

  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::TEXT;
  END LOOP;

  raw_display := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
    NULLIF(btrim(email_prefix), ''),
    'User'
  );
  final_display := substring(raw_display, 1, 60);

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    final_username,
    final_display,
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')), '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
