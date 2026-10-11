-- Production hardening for organization RLS and n8n write paths.

-- service_role bypasses RLS already. This legacy PUBLIC policy allowed every
-- authenticated user to insert messages without an organization check.
DROP POLICY IF EXISTS "Service role can insert messages" ON messages;

-- These legacy policies survived the organization migration because their
-- names differed from the DROP statements in that migration.
DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;
DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;

-- Managers must not be able to promote themselves or disable owners.
DROP POLICY IF EXISTS "Org admins can manage organization members" ON organization_members;
CREATE POLICY "Org admins can manage organization members"
  ON organization_members FOR ALL TO authenticated
  USING (public.has_organization_role(organization_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_organization_role(organization_id, ARRAY['owner','admin']));

-- Reactions must follow organization membership and an agent may only mutate
-- their own reaction. Webhook writes use service_role and bypass these rules.
DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;
DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;
DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;
DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;
DROP POLICY IF EXISTS "Org members can read message reactions" ON message_reactions;
DROP POLICY IF EXISTS "Agents can insert their own reactions" ON message_reactions;
DROP POLICY IF EXISTS "Agents can update their own reactions" ON message_reactions;
DROP POLICY IF EXISTS "Agents can delete their own reactions" ON message_reactions;

CREATE POLICY "Org members can read message reactions"
  ON message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = message_reactions.conversation_id
      WHERE m.id = message_reactions.message_id
        AND m.conversation_id = c.id
        AND public.is_organization_member(c.organization_id)
    )
  );

CREATE POLICY "Agents can insert their own reactions"
  ON message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = message_reactions.conversation_id
      WHERE m.id = message_reactions.message_id
        AND m.conversation_id = c.id
        AND public.is_organization_member(c.organization_id)
    )
  );

CREATE POLICY "Agents can update their own reactions"
  ON message_reactions FOR UPDATE TO authenticated
  USING (actor_type = 'agent' AND actor_id = auth.uid())
  WITH CHECK (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = message_reactions.conversation_id
      WHERE m.id = message_reactions.message_id
        AND m.conversation_id = c.id
        AND public.is_organization_member(c.organization_id)
    )
  );

CREATE POLICY "Agents can delete their own reactions"
  ON message_reactions FOR DELETE TO authenticated
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM messages m
      JOIN conversations c ON c.id = message_reactions.conversation_id
      WHERE m.id = message_reactions.message_id
        AND m.conversation_id = c.id
        AND public.is_organization_member(c.organization_id)
    )
  );

-- Reconcile the production n8n completion schema with the application.
ALTER TABLE n8n_event_statuses
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

UPDATE n8n_event_statuses
SET idempotency_key = event_id
WHERE idempotency_key IS NULL;

ALTER TABLE n8n_event_statuses
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS n8n_event_statuses_unique_idempotency_idx
  ON n8n_event_statuses (organization_id, idempotency_key);

DROP POLICY IF EXISTS "Members can read n8n_event_statuses" ON n8n_event_statuses;
DROP POLICY IF EXISTS "Managers can write n8n_event_statuses" ON n8n_event_statuses;
DROP POLICY IF EXISTS "service role can manage n8n event statuses" ON n8n_event_statuses;
CREATE POLICY "service role can manage n8n event statuses"
  ON n8n_event_statuses FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- PostgREST cannot infer a partial unique index from on_conflict columns.
-- These RPCs preserve the intended "one active row" rules atomically.
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

  IF p_property_id IS NOT NULL THEN
    UPDATE appointments
    SET conversation_id = p_conversation_id,
        assigned_agent_id = p_assigned_agent_id,
        requested_start_at = p_requested_start_at,
        proposed_start_at = p_proposed_start_at,
        status = p_status,
        notes = p_notes
    WHERE organization_id = p_organization_id
      AND contact_id = p_contact_id
      AND property_id = p_property_id
      AND status IN ('requested', 'proposed', 'confirmed')
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO appointments (
        organization_id, contact_id, conversation_id, property_id,
        assigned_agent_id, requested_start_at, proposed_start_at, status, notes
      )
      VALUES (
        p_organization_id, p_contact_id, p_conversation_id, p_property_id,
        p_assigned_agent_id, p_requested_start_at, p_proposed_start_at, p_status, p_notes
      )
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      UPDATE appointments
      SET conversation_id = p_conversation_id,
          assigned_agent_id = p_assigned_agent_id,
          requested_start_at = p_requested_start_at,
          proposed_start_at = p_proposed_start_at,
          status = p_status,
          notes = p_notes
      WHERE organization_id = p_organization_id
        AND contact_id = p_contact_id
        AND property_id = p_property_id
        AND status IN ('requested', 'proposed', 'confirmed')
      RETURNING id INTO v_id;
    END;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_pending_follow_up(
  p_organization_id UUID,
  p_contact_id UUID,
  p_conversation_id UUID,
  p_assigned_agent_id UUID,
  p_reason TEXT,
  p_due_at TIMESTAMPTZ,
  p_source TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE follow_up_tasks
  SET conversation_id = p_conversation_id,
      assigned_agent_id = p_assigned_agent_id,
      due_at = p_due_at,
      source = p_source
  WHERE organization_id = p_organization_id
    AND contact_id = p_contact_id
    AND reason = p_reason
    AND status IN ('pending', 'scheduled')
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO follow_up_tasks (
        organization_id, contact_id, conversation_id, assigned_agent_id,
        reason, due_at, status, source
      )
      VALUES (
        p_organization_id, p_contact_id, p_conversation_id, p_assigned_agent_id,
        p_reason, p_due_at, 'pending', p_source
      )
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_id
      FROM follow_up_tasks
      WHERE organization_id = p_organization_id
        AND contact_id = p_contact_id
        AND reason = p_reason
        AND status IN ('pending', 'scheduled')
      LIMIT 1;
    END;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_active_appointment(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_active_appointment(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_active_appointment(UUID, UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_pending_follow_up(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_pending_follow_up(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pending_follow_up(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
