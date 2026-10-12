import { NextResponse } from 'next/server';
import { requireOrganizationContext } from '@/lib/organizations';
import { assertSlotAvailable } from '@/lib/real-estate/slots';
import { isUuid } from '@/lib/internal-secret';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(request: Request) {
  const guard = await requireOrganizationContext([
    'owner',
    'admin',
    'manager',
    'agent',
  ]);
  if (!guard.ok) return guard.response;
  const db = supabaseAdmin();

  const body = (await request.json().catch(() => null)) as {
    contact_id?: string;
    property_id?: string | null;
    appointment_id?: string | null;
    agent_id?: string | null;
    slot_start_at?: string;
    slot_end_at?: string;
    idempotency_key?: string;
  } | null;
  if (
    !body?.contact_id ||
    !body.slot_start_at ||
    !body.slot_end_at ||
    !body.idempotency_key
  ) {
    return NextResponse.json(
      {
        error:
          'contact_id, slot_start_at, slot_end_at, and idempotency_key are required',
      },
      { status: 400 }
    );
  }

  let available: boolean;
  try {
    available = await assertSlotAvailable({
      db,
      organizationId: guard.organizationId,
      slotStartAt: body.slot_start_at,
      slotEndAt: body.slot_end_at,
      agentId: body.agent_id ?? null,
      excludeAppointmentId: body.appointment_id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to check slot availability',
      },
      { status: 500 }
    );
  }
  if (!available) {
    return NextResponse.json(
      { error: 'Slot is no longer available' },
      { status: 409 }
    );
  }

  const { data, error } = await db
    .from('appointment_slot_locks')
    .upsert(
      {
        organization_id: guard.organizationId,
        contact_id: body.contact_id,
        property_id: isUuid(body.property_id) ? body.property_id : null,
        appointment_id: isUuid(body.appointment_id)
          ? body.appointment_id
          : null,
        agent_id: isUuid(body.agent_id) ? body.agent_id : null,
        slot_start_at: body.slot_start_at,
        slot_end_at: body.slot_end_at,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        status: 'held',
        idempotency_key: body.idempotency_key,
      },
      { onConflict: 'organization_id,idempotency_key' }
    )
    .select('*')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ slot_lock: data });
}
