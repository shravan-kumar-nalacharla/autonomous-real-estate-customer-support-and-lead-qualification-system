import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertSlotAvailable } from './slots';

function fakeDb(
  results: Record<
    string,
    { data: unknown[] | null; error: { message: string } | null }
  >
) {
  return {
    from(table: string) {
      let result = results[table];
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gt: () => query,
        lt: () => query,
        neq: (_column: string, value: string) => {
          if (table === 'appointments' && result.data) {
            result = {
              ...result,
              data: result.data.filter(
                (row) => (row as { id?: string }).id !== value
              ),
            };
          }
          return query;
        },
        then: (resolve: (value: typeof result) => void) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('assertSlotAvailable', () => {
  const slot = {
    organizationId: 'org-1',
    slotStartAt: '2026-10-13T06:30:00.000Z',
    slotEndAt: '2026-10-13T07:15:00.000Z',
    agentId: null,
  };

  it('ignores the appointment and lock currently being confirmed', async () => {
    const db = fakeDb({
      appointments: {
        data: [
          {
            id: 'appointment-1',
            assigned_agent_id: null,
            proposed_start_at: slot.slotStartAt,
            confirmed_start_at: null,
          },
        ],
        error: null,
      },
      appointment_slot_locks: {
        data: [
          {
            id: 'lock-1',
            appointment_id: 'appointment-1',
            agent_id: null,
            slot_start_at: slot.slotStartAt,
            slot_end_at: slot.slotEndAt,
          },
        ],
        error: null,
      },
      agent_time_off: { data: [], error: null },
    });

    await expect(
      assertSlotAvailable({
        db,
        ...slot,
        excludeAppointmentId: 'appointment-1',
      })
    ).resolves.toBe(true);
  });

  it('reports availability query failures instead of calling the slot unavailable', async () => {
    const db = fakeDb({
      appointments: { data: null, error: { message: 'database offline' } },
      appointment_slot_locks: { data: [], error: null },
      agent_time_off: { data: [], error: null },
    });

    await expect(assertSlotAvailable({ db, ...slot })).rejects.toThrow(
      'Failed to check slot availability: database offline'
    );
  });
});
