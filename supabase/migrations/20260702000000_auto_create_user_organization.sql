-- ============================================================
-- Auto-create an organization for new users.
--
-- The original signup trigger created only public.profiles. After
-- organization tenancy was added, users created after the tenancy
-- migration could sign in but had no organization_members row, causing
-- org-scoped pages to report "No active organization membership".
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_org_id UUID;
BEGIN
  v_full_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1), 'Real Estate Agency');

  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email)
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name);

  INSERT INTO public.organizations (name, slug, timezone, created_by)
  VALUES (
    v_full_name || '''s Agency',
    'user-' || NEW.id::text,
    'Asia/Kolkata',
    NEW.id
  )
  ON CONFLICT (slug) DO UPDATE
  SET updated_at = NOW()
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org_id, NEW.id, 'owner', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET role = 'owner', status = 'active', updated_at = NOW();

  UPDATE public.profiles
  SET active_organization_id = COALESCE(active_organization_id, v_org_id)
  WHERE user_id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile/organization for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.ensure_user_organization(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_full_name TEXT;
  v_org_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot create organization for another user';
  END IF;

  SELECT u.email, COALESCE(NULLIF(p.full_name, ''), NULLIF(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1), 'Real Estate Agency')
  INTO v_email, v_full_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  SELECT om.organization_id
  INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = p_user_id
    AND om.status = 'active'
  ORDER BY om.created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name, slug, timezone, created_by)
    VALUES (
      v_full_name || '''s Agency',
      'user-' || p_user_id::text,
      'Asia/Kolkata',
      p_user_id
    )
    ON CONFLICT (slug) DO UPDATE
    SET updated_at = NOW()
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_org_id, p_user_id, 'owner', 'active')
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = 'owner', status = 'active', updated_at = NOW();
  END IF;

  INSERT INTO public.profiles (user_id, full_name, email, active_organization_id)
  VALUES (p_user_id, v_full_name, v_email, v_org_id)
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    active_organization_id = COALESCE(public.profiles.active_organization_id, EXCLUDED.active_organization_id);

  RETURN v_org_id;
END;
$$;

ALTER FUNCTION public.ensure_user_organization(UUID) OWNER TO postgres;
