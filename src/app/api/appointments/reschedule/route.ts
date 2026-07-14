import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import { assertSlotAvailable } from "@/lib/real-estate/slots";

export async function POST(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager", "agent"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { appointment_id?: string; slot_start_at?: string; slot_end_at?: string; agent_id?: string | null }
    | null;
  if (!body?.appointment_id || !body.slot_start_at || !body.slot_end_at) {
    return NextResponse.json(
      { error: "appointment_id, slot_start_at, and slot_end_at are required" },
      { status: 400 },
    );
  }

  const available = await assertSlotAvailable({
    db: guard.supabase,
    organizationId: guard.organizationId,
    slotStartAt: body.slot_start_at,
    slotEndAt: body.slot_end_at,
    agentId: body.agent_id ?? null,
  });
  if (!available) return NextResponse.json({ error: "Slot is no longer available" }, { status: 409 });

  const { data, error } = await guard.supabase
    .from("appointments")
    .update({
      proposed_start_at: body.slot_start_at,
      confirmed_start_at: null,
      status: "proposed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.appointment_id)
    .eq("organization_id", guard.organizationId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ appointment: data });
}
