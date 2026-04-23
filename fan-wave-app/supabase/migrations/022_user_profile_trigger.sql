-- Migration 022: auto-create a public.users profile row on auth signup.
--
-- Before this, nothing created the profile. App code that joins on
-- public.users (create-clip, profile, etc.) crashed with "profile not found"
-- for any user who signed up through Supabase auth.
--
-- Uses SECURITY DEFINER so the trigger can write to public.users regardless
-- of the triggering session's RLS. Back-fills any existing auth.users that
-- don't yet have a matching profile row.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (auth_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1),
      'Fan'
    )
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Back-fill: any auth.users without a matching public.users row get one.
INSERT INTO public.users (auth_id, display_name)
SELECT
  au.id,
  COALESCE(
    au.raw_user_meta_data->>'display_name',
    split_part(au.email, '@', 1),
    'Fan'
  )
FROM auth.users au
LEFT JOIN public.users u ON u.auth_id = au.id
WHERE u.id IS NULL
ON CONFLICT (auth_id) DO NOTHING;
