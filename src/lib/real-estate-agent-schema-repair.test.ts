import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261011000000_repair_real_estate_agent_requirements.sql'
  ),
  'utf8'
);

describe('real-estate agent schema repair', () => {
  it('adds the complete requirements payload and reloads PostgREST', () => {
    for (const column of [
      'amenities',
      'financing_required',
      'loan_preapproved',
      'parking_required',
      'preferred_appointment_at',
      'seller_property_details',
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
