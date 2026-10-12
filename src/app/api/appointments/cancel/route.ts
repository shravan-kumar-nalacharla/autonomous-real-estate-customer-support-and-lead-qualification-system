import { NextResponse } from 'next/server';
import { requireOrganizationContext } from '@/lib/organizations';
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
    appointment_id?: string;
    reason?: string;
  } | null;
  if (!body?.appointment_id) {
    return NextResponse.json(
      { error: 'appointment_id is required' },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from('appointments')
    .update({
      status: 'cancelled',
      notes: body.reason ?? 'Appointment cancelled.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.appointment_id)
    .eq('organization_id', guard.organizationId)
    .select('*')
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'Appointment not found' },
      { status: 404 }
    );
  await db
    .from('appointment_slot_locks')
    .update({ status: 'released' })
    .eq('appointment_id', body.appointment_id)
    .eq('organization_id', guard.organizationId);
  await db
    .from('conversations')
    .update({
      pipeline_stage: 'requirements_captured',
      updated_at: new Date().toISOString(),
    })
    .eq('contact_id', data.contact_id)
    .eq('organization_id', guard.organizationId)
    .in('pipeline_stage', [
      'site_visit_requested',
      'site_visit_proposed',
      'site_visit_confirmed',
    ]);
  return NextResponse.json({ appointment: data });
}
