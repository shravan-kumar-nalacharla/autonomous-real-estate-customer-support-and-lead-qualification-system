import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";

export async function GET() {
  const guard = await requireOrganizationContext(["owner", "admin", "manager", "agent"]);
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("agent_availability_rules")
    .select("*")
    .eq("organization_id", guard.organizationId)
    .order("weekday")
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string;
        agent_id?: string | null;
        weekday?: number;
        start_time?: string;
        end_time?: string;
        timezone?: string;
        is_active?: boolean;
      }
    | null;
  if (
    body?.weekday == null ||
    !body.start_time ||
    !body.end_time ||
    body.weekday < 0 ||
    body.weekday > 6
  ) {
    return NextResponse.json(
      { error: "weekday, start_time, and end_time are required" },
      { status: 400 },
    );
  }

  const payload = {
    organization_id: guard.organizationId,
    agent_id: body.agent_id ?? guard.user.id,
    weekday: body.weekday,
    start_time: body.start_time,
    end_time: body.end_time,
    timezone: body.timezone ?? "Asia/Kolkata",
    is_active: body.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  const query = body.id
    ? guard.supabase
        .from("agent_availability_rules")
        .update(payload)
        .eq("id", body.id)
        .eq("organization_id", guard.organizationId)
    : guard.supabase.from("agent_availability_rules").insert(payload);

  const { data, error } = await query.select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}
