-- Production n8n real-estate endpoints + internal slot booking support.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS automation_paused BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_org_idempotency_key
  ON messages(organization_id, idempotency_key)
  WHERE organization_id IS NOT NULL AND idempotency_key IS NOT NULL;

ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS customer_role TEXT DEFAULT 'unknown';
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS listing_intent TEXT DEFAULT 'unknown';
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS property_category TEXT DEFAULT 'unknown';
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS property_stage TEXT DEFAULT 'unknown';
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS bedrooms INTEGER;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS bathrooms INTEGER;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS area_min NUMERIC(14,2);
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS area_max NUMERIC(14,2);
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS area_unit TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS plot_facing TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS road_width TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS approval_authority TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS rera_id TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS possession_timeline TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS buying_timeline TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS financing_required BOOLEAN;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS loan_preapproved BOOLEAN;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS furnishing TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS parking_required BOOLEAN;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS preferred_appointment_date DATE;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS preferred_appointment_time TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS preferred_appointment_at TIMESTAMPTZ;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS property_reference TEXT;
ALTER TABLE lead_requirements ADD COLUMN IF NOT EXISTS seller_property_details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS listing_intent TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_category TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_stage TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS area_min NUMERIC(14,2);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS area_max NUMERIC(14,2);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS area_unit TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS plot_facing TEXT;

CREATE TABLE IF NOT EXISTS n8n_event_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, event_id)
);

CREATE TABLE IF NOT EXISTS agent_availability_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_time_off (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_visit_settings (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  default_visit_duration_minutes INTEGER NOT NULL DEFAULT 45,
  travel_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  allowed_agents UUID[] NOT NULL DEFAULT ARRAY[]::UUID[]
);

UPDATE property_visit_settings s
SET organization_id = p.organization_id
FROM properties p
WHERE s.property_id = p.id
  AND s.organization_id IS NULL;

ALTER TABLE property_visit_settings ALTER COLUMN organization_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS appointment_slot_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  slot_start_at TIMESTAMPTZ NOT NULL,
  slot_end_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'confirmed')),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_n8n_event_statuses_org_status
  ON n8n_event_statuses(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_slot_conflicts
  ON appointments(organization_id, assigned_agent_id, status, confirmed_start_at, proposed_start_at);
CREATE INDEX IF NOT EXISTS idx_agent_availability_org_weekday
  ON agent_availability_rules(organization_id, weekday, is_active);
CREATE INDEX IF NOT EXISTS idx_agent_time_off_org_agent
  ON agent_time_off(organization_id, agent_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_slot_locks_conflicts
  ON appointment_slot_locks(organization_id, status, slot_start_at, slot_end_at, expires_at);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'n8n_event_statuses',
    'agent_availability_rules',
    'agent_time_off',
    'property_visit_settings',
    'appointment_slot_locks'
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
      'CREATE POLICY "Managers can write %I" ON %I FOR ALL TO authenticated USING (public.has_organization_role(organization_id, ARRAY[''owner'',''admin'',''manager'',''agent''])) WITH CHECK (public.has_organization_role(organization_id, ARRAY[''owner'',''admin'',''manager'',''agent'']))',
      table_name,
      table_name
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS set_updated_at ON n8n_event_statuses;
DROP TRIGGER IF EXISTS set_updated_at ON agent_availability_rules;
DROP TRIGGER IF EXISTS set_updated_at ON appointment_slot_locks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON n8n_event_statuses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_availability_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointment_slot_locks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
