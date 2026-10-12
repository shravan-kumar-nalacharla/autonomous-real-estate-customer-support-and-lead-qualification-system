import { NextResponse } from 'next/server';
import { requireOrganizationContext } from '@/lib/organizations';
import { assertSlotAvailable } from '@/lib/real-estate/slots';
import { isUuid } from '@/lib/internal-secret';
import { engineSendText } from '@/lib/automations/meta-send';

export async function POST(request: Request) {
  const guard = await requireOrganizationContext([
    'owner',
    'admin',
    'manager',
    'agent',
  ]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as {
    appointment_id?: string;
    slot_lock_id?: string;
    contact_id?: string;
    property_id?: string | null;
    agent_id?: string | null;
    slot_start_at?: string;
    slot_end_at?: string;
  } | null;

  let slotStartAt = body?.slot_start_at;
  let slotEndAt = body?.slot_end_at;
  let contactId = body?.contact_id;
  let propertyId = body?.property_id ?? null;
  let agentId = body?.agent_id ?? null;

  if (body?.slot_lock_id) {
    const { data: lock } = await guard.supabase
      .from('appointment_slot_locks')
      .select('*')
      .eq('id', body.slot_lock_id)
      .eq('organization_id', guard.organizationId)
      .eq('status', 'held')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!lock)
      return NextResponse.json(
        { error: 'Active slot lock not found' },
        { status: 404 }
      );
    slotStartAt = lock.slot_start_at;
    slotEndAt = lock.slot_end_at;
    contactId = lock.contact_id;
    propertyId = lock.property_id;
    agentId = lock.agent_id;
  }

  if (!slotStartAt || !slotEndAt || !contactId) {
    return NextResponse.json(
      { error: 'slot_start_at, slot_end_at, and contact_id are required' },
      { status: 400 }
    );
  }

  const available = await assertSlotAvailable({
    db: guard.supabase,
    organizationId: guard.organizationId,
    slotStartAt,
    slotEndAt,
    agentId,
    excludeAppointmentId: body?.appointment_id,
    excludeLockId: body?.slot_lock_id,
  });
  if (!available && !body?.slot_lock_id) {
    return NextResponse.json(
      { error: 'Slot is no longer available' },
      { status: 409 }
    );
  }

  const payload = {
    organization_id: guard.organizationId,
    contact_id: contactId,
    property_id: isUuid(propertyId) ? propertyId : null,
    assigned_agent_id: isUuid(agentId) ? agentId : null,
    confirmed_start_at: slotStartAt,
    status: 'confirmed',
    updated_at: new Date().toISOString(),
  };
  const query = body?.appointment_id
    ? guard.supabase
        .from('appointments')
        .update(payload)
        .eq('id', body.appointment_id)
        .eq('organization_id', guard.organizationId)
    : guard.supabase.from('appointments').insert(payload);

  const { data, error } = await query
    .select(
      '*, contact:contacts(id, name, phone, user_id), property:properties(id, title, location, locality, property_type)'
    )
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (body?.slot_lock_id) {
    await guard.supabase
      .from('appointment_slot_locks')
      .update({ status: 'confirmed', appointment_id: data.id })
      .eq('id', body.slot_lock_id)
      .eq('organization_id', guard.organizationId);
  }

  await guard.supabase
    .from('conversations')
    .update({
      pipeline_stage: 'site_visit_confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('contact_id', contactId)
    .eq('organization_id', guard.organizationId);

  const contact = firstRelation(data.contact);
  const property = firstRelation(data.property);
  let notificationSent = false;
  let notificationError: string | null = null;

  if (data.conversation_id && contact?.user_id) {
    const [{ data: requirements }, { data: organization }] = await Promise.all([
      guard.supabase
        .from('lead_requirements')
        .select('property_type, preferred_locations')
        .eq('organization_id', guard.organizationId)
        .eq('contact_id', contactId)
        .maybeSingle(),
      guard.supabase
        .from('organizations')
        .select('name, timezone')
        .eq('id', guard.organizationId)
        .maybeSingle(),
    ]);

    const propertyType = humanize(
      property?.property_type ?? requirements?.property_type ?? 'property'
    );
    const location =
      [property?.locality, property?.location].filter(Boolean).join(', ') ||
      requirements?.preferred_locations?.filter(Boolean).join(', ') ||
      'the agreed location';
    const dateTime = formatVisitTime(
      slotStartAt,
      organization?.timezone ?? 'Asia/Kolkata'
    );
    const company = organization?.name || 'EastWest Real Estates';
    const propertyLabel = property?.title
      ? `${property.title} (${propertyType})`
      : propertyType;
    const confirmation = `Your site visit with ${company} is confirmed.\n\nProperty: ${propertyLabel}\nLocation: ${location}\nDate & time: ${dateTime}\n\nPlease reply here if you need to reschedule.`;

    try {
      await engineSendText({
        userId: contact.user_id,
        conversationId: data.conversation_id,
        contactId,
        text: confirmation,
      });
      notificationSent = true;
    } catch (sendError) {
      notificationError =
        sendError instanceof Error
          ? sendError.message
          : 'WhatsApp confirmation failed';
      console.error(
        '[appointments/confirm] confirmation send failed:',
        notificationError
      );
    }
  } else {
    notificationError =
      'Appointment has no WhatsApp conversation or contact owner';
  }

  return NextResponse.json({
    appointment: data,
    notification_sent: notificationSent,
    notification_error: notificationError,
  });
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function humanize(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatVisitTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}
