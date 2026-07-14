import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import { generateAppointmentSlots } from "@/lib/real-estate/slots";

export async function GET(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager", "agent"]);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date is required in YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  try {
    const slots = await generateAppointmentSlots({
      db: guard.supabase,
      organizationId: guard.organizationId,
      date,
      propertyId: url.searchParams.get("property_id"),
      agentId: url.searchParams.get("agent_id"),
      durationMinutes: Number(url.searchParams.get("duration_minutes")) || null,
    });
    return NextResponse.json({ slots });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate slots" },
      { status: 500 },
    );
  }
}
