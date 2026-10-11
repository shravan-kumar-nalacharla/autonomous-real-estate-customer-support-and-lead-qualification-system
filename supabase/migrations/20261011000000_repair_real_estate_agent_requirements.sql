-- Repair databases created before the complete real-estate agent requirements
-- schema landed. Safe to run repeatedly in the Supabase SQL Editor.

ALTER TABLE public.lead_requirements
  ADD COLUMN IF NOT EXISTS customer_role TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS listing_intent TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS property_category TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS property_stage TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS bedrooms INTEGER,
  ADD COLUMN IF NOT EXISTS bathrooms INTEGER,
  ADD COLUMN IF NOT EXISTS area_min NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS area_max NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS area_unit TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS plot_facing TEXT,
  ADD COLUMN IF NOT EXISTS road_width TEXT,
  ADD COLUMN IF NOT EXISTS approval_authority TEXT,
  ADD COLUMN IF NOT EXISTS rera_id TEXT,
  ADD COLUMN IF NOT EXISTS possession_timeline TEXT,
  ADD COLUMN IF NOT EXISTS buying_timeline TEXT,
  ADD COLUMN IF NOT EXISTS financing_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS loan_preapproved BOOLEAN,
  ADD COLUMN IF NOT EXISTS furnishing TEXT,
  ADD COLUMN IF NOT EXISTS parking_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS preferred_appointment_date DATE,
  ADD COLUMN IF NOT EXISTS preferred_appointment_time TEXT,
  ADD COLUMN IF NOT EXISTS preferred_appointment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS property_reference TEXT,
  ADD COLUMN IF NOT EXISTS seller_property_details JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
