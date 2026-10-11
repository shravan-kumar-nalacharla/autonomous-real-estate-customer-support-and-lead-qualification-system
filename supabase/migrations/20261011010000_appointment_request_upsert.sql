-- Keep one active appointment request per contact/property, including the
-- property-less request created before a customer chooses a listing.

CREATE OR REPLACE FUNCTION public.upsert_active_appointment(
  p_organization_id UUID,
  p_contact_id UUID,
  p_conversation_id UUID,
  p_property_id UUID,
  p_assigned_agent_id UUID,
  p_requested_start_at TIMESTAMPTZ,
  p_proposed_start_at TIMESTAMPTZ,
  p_status TEXT,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_status NOT IN ('requested', 'proposed', 'confirmed') THEN
    RAISE EXCEPTION 'Invalid active appointment status: %', p_status;
  END IF;

  -- Serialize requests for the same contact/property, including NULL property.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_contact_id::text || ':' || COALESCE(p_property_id::text, 'none'),
      0
    )
  );

  SELECT id INTO v_id
  FROM appointments
  WHERE organization_id = p_organization_id
    AND contact_id = p_contact_id
    AND property_id IS NOT DISTINCT FROM p_property_id
    AND status IN ('requested', 'proposed', 'confirmed')
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO appointments (
      organization_id, contact_id, conversation_id, property_id,
      assigned_agent_id, requested_start_at, proposed_start_at, status, notes
    )
    VALUES (
      p_organization_id, p_contact_id, p_conversation_id, p_property_id,
      p_assigned_agent_id, p_requested_start_at, p_proposed_start_at, p_status, p_notes
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE appointments
    SET conversation_id = p_conversation_id,
        assigned_agent_id = COALESCE(p_assigned_agent_id, assigned_agent_id),
        requested_start_at = COALESCE(p_requested_start_at, requested_start_at),
        proposed_start_at = COALESCE(p_proposed_start_at, proposed_start_at),
        status = p_status,
        notes = COALESCE(NULLIF(p_notes, ''), notes),
        updated_at = NOW()
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_active_appointment(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_active_appointment(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_active_appointment(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
