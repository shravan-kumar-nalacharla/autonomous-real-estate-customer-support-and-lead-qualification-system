import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";

export async function GET() {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("appointments")
    .select(
      "*, contact:contacts(name, phone), property:properties(title, location, locality)",
    )
    .eq("organization_id", guard.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ appointments: data ?? [] });
}

export async function PATCH(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager", "agent"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | { id?: string; status?: string; proposed_start_at?: string | null; confirmed_start_at?: string | null }
    | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const allowed = new Set([
    "requested",
    "proposed",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
  ]);
  if (body.status && !allowed.has(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.status) update.status = body.status;
  if ("proposed_start_at" in body) update.proposed_start_at = body.proposed_start_at;
  if ("confirmed_start_at" in body) update.confirmed_start_at = body.confirmed_start_at;

  const { data, error } = await guard.supabase
    .from("appointments")
    .update(update)
    .eq("id", body.id)
    .eq("organization_id", guard.organizationId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }
  return NextResponse.json({ appointment: data });
}
