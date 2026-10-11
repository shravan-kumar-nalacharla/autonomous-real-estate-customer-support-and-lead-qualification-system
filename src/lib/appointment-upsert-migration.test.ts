import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261011010000_appointment_request_upsert.sql'
  ),
  'utf8'
);

describe('appointment request upsert migration', () => {
  it('updates active requests even when property_id is null', () => {
    expect(migration).toContain(
      'property_id IS NOT DISTINCT FROM p_property_id'
    );
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('ORDER BY updated_at DESC, created_at DESC');
  });
});
