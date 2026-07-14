import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";

export async function POST(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager", "agent"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { appointment_id?: string; reason?: string }
    | null;
  if (!body?.appointment_id) {
    return NextResponse.json({ error: "appointment_id is required" }, { status: 400 });
  }

  const { data, error } = await guard.supabase
    .from("appointments")
    .update({
      status: "cancelled",
      notes: body.reason ?? "Appointment cancelled.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.appointment_id)
    .eq("organization_id", guard.organizationId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await guard.supabase
    .from("appointment_slot_locks")
    .update({ status: "released" })
    .eq("appointment_id", body.appointment_id)
    .eq("organization_id", guard.organizationId);
  return NextResponse.json({ appointment: data });
}
