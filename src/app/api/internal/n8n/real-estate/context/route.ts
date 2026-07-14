import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-secret";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  getEventDuplicateState,
  resolveRealEstateContext,
  type N8nEventEnvelope,
} from "@/lib/real-estate/n8n-context";

export async function POST(request: Request) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { event?: N8nEventEnvelope }
    | null;
  if (!body?.event) {
    return NextResponse.json({ error: "event is required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const resolved = await resolveRealEstateContext(db, body.event);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const { organizationId, conversation, contact } = resolved;
  const [
    organizationResult,
    requirementsResult,
    scoreResult,
    recommendationsResult,
    appointmentsResult,
    handoffResult,
    duplicateState,
  ] = await Promise.all([
    db
      .from("organizations")
      .select("id, name, timezone")
      .eq("id", organizationId)
      .maybeSingle(),
    contact?.id
      ? db
          .from("lead_requirements")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("contact_id", String(contact.id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contact?.id
      ? db
          .from("lead_scores")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("contact_id", String(contact.id))
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contact?.id
      ? db
          .from("property_recommendations")
          .select("*, property:properties(id,title,property_type,listing_type,location,locality,city,price)")
          .eq("organization_id", organizationId)
          .eq("contact_id", String(contact.id))
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    contact?.id
      ? db
          .from("appointments")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("contact_id", String(contact.id))
          .in("status", ["requested", "proposed", "confirmed"])
      : Promise.resolve({ data: [], error: null }),
    conversation?.id
      ? db
          .from("human_handoffs")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("conversation_id", String(conversation.id))
          .in("status", ["open", "accepted"])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getEventDuplicateState(db, {
      organizationId,
      eventId: body.event.event_id,
      messageId: body.event.message_id,
    }),
  ]);

  if (organizationResult.error || !organizationResult.data) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json({
    organization: organizationResult.data,
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          phone_verified: Boolean(contact.phone_verified),
          opted_out: Boolean(contact.opted_out),
        }
      : null,
    conversation: conversation
      ? {
          id: conversation.id,
          automation_mode: conversation.automation_mode,
          automation_paused: Boolean(conversation.automation_paused),
          handoff_active: Boolean(handoffResult.data),
          pipeline_stage: conversation.pipeline_stage ?? null,
        }
      : null,
    lead_requirements: requirementsResult.data,
    latest_lead_score: scoreResult.data,
    recent_recommendations: recommendationsResult.data ?? [],
    active_appointments: appointmentsResult.data ?? [],
    event_is_duplicate: duplicateState.event_is_duplicate,
    event_already_completed: duplicateState.event_already_completed,
  });
}
