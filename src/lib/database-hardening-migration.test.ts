import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260716000000_database_hardening.sql'
  ),
  'utf8'
);

describe('database hardening migration', () => {
  it('removes the legacy unrestricted message insert policy', () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Service role can insert messages" ON messages'
    );
  });

  it('limits reaction writes to the authenticated agent', () => {
    expect(migration).toContain("actor_type = 'agent'");
    expect(migration).toContain('actor_id = auth.uid()');
    expect(migration).toContain(
      'public.is_organization_member(c.organization_id)'
    );
  });

  it('prevents managers from changing organization membership', () => {
    expect(migration).toContain(
      "public.has_organization_role(organization_id, ARRAY['owner','admin'])"
    );
  });

  it('provides atomic RPCs for partial-unique active records', () => {
    expect(migration).toContain('public.upsert_active_appointment');
    expect(migration).toContain('public.upsert_pending_follow_up');
    expect(migration).toContain('EXCEPTION WHEN unique_violation');
  });

  it('locks n8n event status writes to service_role', () => {
    expect(migration).toContain('error_message TEXT');
    expect(migration).toContain(
      'ON n8n_event_statuses FOR ALL TO service_role'
    );
    expect(migration).toContain('n8n_event_statuses_unique_idempotency_idx');
  });
});
