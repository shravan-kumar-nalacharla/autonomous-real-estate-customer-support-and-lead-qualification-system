-- ============================================================
-- Organization tenancy + real-estate lead qualification domain.
--
-- Forward-only migration. Legacy rows with direct user ownership are
-- backfilled into one organization per owner. Legacy n8n rows have no
-- owner signal, so they remain organization_id NULL and are disabled /
-- hidden by the new RLS policies until an operator re-creates them in
-- an organization-scoped settings page.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Organizations and membership
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  business_hours JSONB NOT NULL DEFAULT
    '{"days":[1,2,3,4,5,6],"start":"09:00","end":"18:00","quiet_start":"20:00","quiet_end":"09:00"}'::jsonb,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'agent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON organization_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_role
  ON organization_members(organization_id, role, status);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_organization_member(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_organization_role(
  p_organization_id UUID,
  p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.is_organization_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_organization_role(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organization_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_organization_role(UUID, TEXT[]) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Org admins can update organizations" ON organizations;
CREATE POLICY "Members can view their organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (public.is_organization_member(id));
CREATE POLICY "Org admins can update organizations"
  ON organizations FOR UPDATE
  TO authenticated
  USING (public.has_organization_role(id, ARRAY['owner','admin']))
  WITH CHECK (public.has_organization_role(id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS "Members can view organization members" ON organization_members;
DROP POLICY IF EXISTS "Org admins can manage organization members" ON organization_members;
CREATE POLICY "Members can view organization members"
  ON organization_members FOR SELECT
  TO authenticated
  USING (public.is_organization_member(organization_id));
CREATE POLICY "Org admins can manage organization members"
  ON organization_members FOR ALL
  TO authenticated
  USING (public.has_organization_role(organization_id, ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

-- Create one organization per existing user profile. This is safe because
-- each legacy CRM row already points at a specific user_id.
INSERT INTO organizations (name, slug, created_by)
SELECT
  COALESCE(NULLIF(p.full_name, ''), split_part(p.email, '@', 1), 'Real Estate Agency') || '''s Agency',
  'legacy-' || p.user_id::text,
  p.user_id
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members om WHERE om.user_id = p.user_id
);

INSERT INTO organization_members (organization_id, user_id, role, status)
SELECT o.id, p.user_id, 'owner', 'active'
FROM profiles p
JOIN organizations o ON o.slug = 'legacy-' || p.user_id::text
ON CONFLICT (organization_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.default_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.organization_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
  ORDER BY
    CASE om.role
      WHEN 'owner' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'manager' THEN 3
      ELSE 4
    END,
    om.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.default_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_organization_id() TO authenticated, service_role;

-- ============================================================
-- 2. Organization ownership columns and safe legacy backfill
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
UPDATE profiles p
SET active_organization_id = om.organization_id
FROM organization_members om
WHERE p.user_id = om.user_id
  AND om.role = 'owner'
  AND p.active_organization_id IS NULL;

ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE contact_tags ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE contact_custom_values ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE contact_notes ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE automation_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE automation_steps ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE automation_pending_executions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE flows ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE flow_nodes ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE flow_run_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE n8n_workflows ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE n8n_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE whatsapp_config t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE contacts t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE conversations t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE tags t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE custom_fields t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE contact_notes t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE message_templates t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE pipelines t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE deals t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE broadcasts t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE automations t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE automation_logs t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE automation_pending_executions t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE flows t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;
UPDATE flow_runs t SET organization_id = om.organization_id
FROM organization_members om WHERE t.user_id = om.user_id AND t.organization_id IS NULL;

UPDATE conversations c SET organization_id = ct.organization_id
FROM contacts ct WHERE c.contact_id = ct.id AND c.organization_id IS NULL;
UPDATE messages m SET organization_id = c.organization_id
FROM conversations c WHERE m.conversation_id = c.id AND m.organization_id IS NULL;
UPDATE contact_tags t SET organization_id = c.organization_id
FROM contacts c WHERE t.contact_id = c.id AND t.organization_id IS NULL;
UPDATE contact_custom_values t SET organization_id = c.organization_id
FROM contacts c WHERE t.contact_id = c.id AND t.organization_id IS NULL;
UPDATE pipeline_stages s SET organization_id = p.organization_id
FROM pipelines p WHERE s.pipeline_id = p.id AND s.organization_id IS NULL;
UPDATE broadcast_recipients r SET organization_id = b.organization_id
FROM broadcasts b WHERE r.broadcast_id = b.id AND r.organization_id IS NULL;
UPDATE automation_steps s SET organization_id = a.organization_id
FROM automations a WHERE s.automation_id = a.id AND s.organization_id IS NULL;
UPDATE flow_nodes n SET organization_id = f.organization_id
FROM flows f WHERE n.flow_id = f.id AND n.organization_id IS NULL;
UPDATE flow_run_events e SET organization_id = r.organization_id
FROM flow_runs r WHERE e.flow_run_id = r.id AND e.organization_id IS NULL;

-- Ambiguous legacy n8n rows cannot be safely assigned. Disable workflow
-- execution and make them invisible to authenticated clients.
UPDATE n8n_workflows
SET is_active = false,
    last_error = COALESCE(last_error, 'Quarantined by migration 015: legacy workflow had no organization owner'),
    updated_at = NOW()
WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_org ON whatsapp_config(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_org_conversation ON messages(organization_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipelines_org ON pipelines(organization_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_org ON broadcasts(organization_id);
CREATE INDEX IF NOT EXISTS idx_automations_org ON automations(organization_id);
CREATE INDEX IF NOT EXISTS idx_flows_org ON flows(organization_id);
CREATE INDEX IF NOT EXISTS idx_n8n_workflows_org_event ON n8n_workflows(organization_id, trigger_event, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_n8n_settings_one_per_org
  ON n8n_settings(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_organization_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT om.organization_id
    INTO NEW.organization_id
    FROM organization_members om
    WHERE om.user_id = COALESCE(NEW.user_id, auth.uid())
      AND om.status = 'active'
    ORDER BY
      CASE om.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'manager' THEN 3
        ELSE 4
      END,
      om.created_at
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_from_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'messages' THEN
    SELECT organization_id INTO NEW.organization_id FROM conversations WHERE id = NEW.conversation_id;
  ELSIF TG_TABLE_NAME = 'contact_tags' THEN
    SELECT organization_id INTO NEW.organization_id FROM contacts WHERE id = NEW.contact_id;
  ELSIF TG_TABLE_NAME = 'contact_custom_values' THEN
    SELECT organization_id INTO NEW.organization_id FROM contacts WHERE id = NEW.contact_id;
  ELSIF TG_TABLE_NAME = 'pipeline_stages' THEN
    SELECT organization_id INTO NEW.organization_id FROM pipelines WHERE id = NEW.pipeline_id;
  ELSIF TG_TABLE_NAME = 'broadcast_recipients' THEN
    SELECT organization_id INTO NEW.organization_id FROM broadcasts WHERE id = NEW.broadcast_id;
  ELSIF TG_TABLE_NAME = 'automation_steps' THEN
    SELECT organization_id INTO NEW.organization_id FROM automations WHERE id = NEW.automation_id;
  ELSIF TG_TABLE_NAME = 'flow_nodes' THEN
    SELECT organization_id INTO NEW.organization_id FROM flows WHERE id = NEW.flow_id;
  ELSIF TG_TABLE_NAME = 'flow_run_events' THEN
    SELECT organization_id INTO NEW.organization_id FROM flow_runs WHERE id = NEW.flow_run_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_from_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_from_parent() FROM PUBLIC;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'whatsapp_config',
    'contacts',
    'conversations',
    'tags',
    'custom_fields',
    'contact_notes',
    'message_templates',
    'pipelines',
    'deals',
    'broadcasts',
    'automations',
    'automation_logs',
    'automation_pending_executions',
    'flows'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_org_from_user ON %I', table_name);
    EXECUTE format(
      'CREATE TRIGGER set_org_from_user BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_organization_from_user()',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'messages',
    'contact_tags',
    'contact_custom_values',
    'pipeline_stages',
    'broadcast_recipients',
    'automation_steps',
    'flow_nodes',
    'flow_run_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_org_from_parent ON %I', table_name);
    EXECUTE format(
      'CREATE TRIGGER set_org_from_parent BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_organization_from_parent()',
      table_name
    );
  END LOOP;
END $$;

-- ============================================================
-- 3. Real-estate domain tables
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  preferred_locations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  budget_min NUMERIC(14,2),
  budget_max NUMERIC(14,2),
  property_type TEXT,
  bedroom_count INTEGER,
  listing_type TEXT CHECK (listing_type IN ('sale', 'rent')),
  timeline TEXT,
  financing_interest BOOLEAN,
  site_visit_interest BOOLEAN NOT NULL DEFAULT false,
  contact_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, contact_id)
);

CREATE TABLE IF NOT EXISTS lead_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  requirement_id UUID REFERENCES lead_requirements(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  category TEXT NOT NULL CHECK (category IN ('hot', 'warm', 'cold', 'general_enquiry')),
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, contact_id)
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  property_type TEXT NOT NULL,
  listing_type TEXT NOT NULL CHECK (listing_type IN ('sale', 'rent')),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'sold', 'rented', 'inactive')),
  location TEXT NOT NULL,
  locality TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  area_sqft NUMERIC(12,2),
  price NUMERIC(14,2) NOT NULL,
  amenities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  description TEXT,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  matching_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  viewed_at TIMESTAMPTZ,
  selected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, contact_id, property_id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_start_at TIMESTAMPTZ,
  proposed_start_at TIMESTAMPTZ,
  confirmed_start_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'proposed', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_per_contact_property
  ON appointments(organization_id, contact_id, property_id)
  WHERE status IN ('requested', 'proposed', 'confirmed')
    AND property_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled', 'skipped')),
  source TEXT NOT NULL DEFAULT 'followup_agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_tasks_dedupe_pending
  ON follow_up_tasks(organization_id, contact_id, reason)
  WHERE status IN ('pending', 'scheduled');

CREATE TABLE IF NOT EXISTS human_handoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'resolved', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  agent_type TEXT NOT NULL CHECK (agent_type IN (
    'orchestrator',
    'qualification',
    'property_matching',
    'appointment',
    'followup',
    'escalation',
    'n8n_dispatch'
  )),
  action_type TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  reason TEXT,
  confidence NUMERIC(5,2),
  related_entity_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS event_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_outbox_id UUID NOT NULL REFERENCES event_outbox(id) ON DELETE CASCADE,
  n8n_workflow_id UUID REFERENCES n8n_workflows(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status_code INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_outbox_id, n8n_workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_requirements_org_contact ON lead_requirements(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_org_category ON lead_scores(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_properties_org_status ON properties(organization_id, status, listing_type);
CREATE INDEX IF NOT EXISTS idx_property_recommendations_org_contact ON property_recommendations(organization_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_org_status_time
  ON appointments(organization_id, status, (COALESCE(confirmed_start_at, proposed_start_at, requested_start_at)));
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_org_due ON follow_up_tasks(organization_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_human_handoffs_org_status ON human_handoffs(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_logs_org_contact ON agent_activity_logs(organization_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_outbox_due ON event_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_event_deliveries_due ON event_deliveries(status, next_attempt_at);

-- ============================================================
-- 4. RLS policies
-- ============================================================

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'lead_requirements',
    'lead_scores',
    'properties',
    'property_recommendations',
    'appointments',
    'follow_up_tasks',
    'human_handoffs',
    'agent_activity_logs',
    'event_outbox',
    'event_deliveries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %I" ON %I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Managers can write %I" ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY "Members can read %I" ON %I FOR SELECT TO authenticated USING (public.is_organization_member(organization_id))',
      table_name,
      table_name
    );
    EXECUTE format(
      'CREATE POLICY "Managers can write %I" ON %I FOR ALL TO authenticated USING (public.has_organization_role(organization_id, ARRAY[''owner'',''admin'',''manager''])) WITH CHECK (public.has_organization_role(organization_id, ARRAY[''owner'',''admin'',''manager'']))',
      table_name,
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "authenticated users manage n8n_workflows" ON n8n_workflows;
DROP POLICY IF EXISTS "Members can read n8n_workflows" ON n8n_workflows;
DROP POLICY IF EXISTS "Managers can write n8n_workflows" ON n8n_workflows;
CREATE POLICY "Members can read n8n_workflows"
  ON n8n_workflows FOR SELECT
  TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id));
CREATE POLICY "Managers can write n8n_workflows"
  ON n8n_workflows FOR ALL
  TO authenticated
  USING (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "authenticated users manage n8n_settings" ON n8n_settings;
DROP POLICY IF EXISTS "Members can read n8n_settings" ON n8n_settings;
DROP POLICY IF EXISTS "Managers can write n8n_settings" ON n8n_settings;
CREATE POLICY "Members can read n8n_settings"
  ON n8n_settings FOR SELECT
  TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id));
CREATE POLICY "Managers can write n8n_settings"
  ON n8n_settings FOR ALL
  TO authenticated
  USING (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

-- New organization-aware policies for high-risk CRM tables. Older
-- user_id policies are dropped so collaboration works through org
-- membership rather than only the original row owner.
DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;
DROP POLICY IF EXISTS "Org members can manage contacts" ON contacts;
CREATE POLICY "Org members can manage contacts"
  ON contacts FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;
DROP POLICY IF EXISTS "Org members can manage conversations" ON conversations;
CREATE POLICY "Org members can manage conversations"
  ON conversations FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can view own messages" ON messages;
DROP POLICY IF EXISTS "Org members can manage messages" ON messages;
CREATE POLICY "Org members can manage messages"
  ON messages FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;
DROP POLICY IF EXISTS "Org members can manage pipelines" ON pipelines;
CREATE POLICY "Org members can manage pipelines"
  ON pipelines FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;
DROP POLICY IF EXISTS "Org members can manage pipeline stages" ON pipeline_stages;
CREATE POLICY "Org members can manage pipeline stages"
  ON pipeline_stages FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;
DROP POLICY IF EXISTS "Org members can manage broadcasts" ON broadcasts;
CREATE POLICY "Org members can manage broadcasts"
  ON broadcasts FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;
DROP POLICY IF EXISTS "Org admins can manage whatsapp config" ON whatsapp_config;
CREATE POLICY "Org admins can manage whatsapp config"
  ON whatsapp_config FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "Users can manage own tags" ON tags;
DROP POLICY IF EXISTS "Org members can manage tags" ON tags;
CREATE POLICY "Org members can manage tags"
  ON tags FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;
DROP POLICY IF EXISTS "Org members can manage contact tags" ON contact_tags;
CREATE POLICY "Org members can manage contact tags"
  ON contact_tags FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;
DROP POLICY IF EXISTS "Org members can manage custom fields" ON custom_fields;
CREATE POLICY "Org members can manage custom fields"
  ON custom_fields FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;
DROP POLICY IF EXISTS "Org members can manage custom values" ON contact_custom_values;
CREATE POLICY "Org members can manage custom values"
  ON contact_custom_values FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;
DROP POLICY IF EXISTS "Org members can manage contact notes" ON contact_notes;
CREATE POLICY "Org members can manage contact notes"
  ON contact_notes FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;
DROP POLICY IF EXISTS "Org members can manage message templates" ON message_templates;
CREATE POLICY "Org members can manage message templates"
  ON message_templates FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
DROP POLICY IF EXISTS "Org members can manage deals" ON deals;
CREATE POLICY "Org members can manage deals"
  ON deals FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;
DROP POLICY IF EXISTS "Org members can manage broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Org members can manage broadcast recipients"
  ON broadcast_recipients FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users manage own automations" ON automations;
DROP POLICY IF EXISTS "Org managers can manage automations" ON automations;
CREATE POLICY "Org managers can manage automations"
  ON automations FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "Users view own automation logs" ON automation_logs;
DROP POLICY IF EXISTS "Org members can read automation logs" ON automation_logs;
CREATE POLICY "Org members can read automation logs"
  ON automation_logs FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users manage own automation steps" ON automation_steps;
DROP POLICY IF EXISTS "Org managers can manage automation steps" ON automation_steps;
CREATE POLICY "Org managers can manage automation steps"
  ON automation_steps FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;
DROP POLICY IF EXISTS "Org members can read flow runs" ON flow_runs;
CREATE POLICY "Org members can read flow runs"
  ON flow_runs FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;
DROP POLICY IF EXISTS "Org members can read flow run events" ON flow_run_events;
CREATE POLICY "Org members can read flow run events"
  ON flow_run_events FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;
DROP POLICY IF EXISTS "Org managers can manage flows" ON flows;
CREATE POLICY "Org managers can manage flows"
  ON flows FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON flow_nodes;
DROP POLICY IF EXISTS "Org managers can manage flow nodes" ON flow_nodes;
CREATE POLICY "Org managers can manage flow nodes"
  ON flow_nodes FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.has_organization_role(organization_id, ARRAY['owner','admin','manager']));

-- Update profile access so active_organization_id cannot be pointed at
-- an organization the user does not belong to.
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      active_organization_id IS NULL
      OR public.is_organization_member(active_organization_id)
    )
  );

-- ============================================================
-- 5. Updated-at triggers
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at ON organizations;
DROP TRIGGER IF EXISTS set_updated_at ON organization_members;
DROP TRIGGER IF EXISTS set_updated_at ON lead_requirements;
DROP TRIGGER IF EXISTS set_updated_at ON lead_scores;
DROP TRIGGER IF EXISTS set_updated_at ON properties;
DROP TRIGGER IF EXISTS set_updated_at ON appointments;
DROP TRIGGER IF EXISTS set_updated_at ON follow_up_tasks;
DROP TRIGGER IF EXISTS set_updated_at ON human_handoffs;
DROP TRIGGER IF EXISTS set_updated_at ON event_outbox;
DROP TRIGGER IF EXISTS set_updated_at ON event_deliveries;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_requirements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_scores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON follow_up_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON human_handoffs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON event_deliveries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
