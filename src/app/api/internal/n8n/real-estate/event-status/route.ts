import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-secret";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { isUuid } from "@/lib/internal-secret";

export async function POST(request: Request) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | {
        event_id?: string;
        organization_id?: string;
        idempotency_key?: string;
        outcome?: Record<string, unknown> & { status?: string; error?: string };
      }
    | null;
  if (!body?.event_id || !isUuid(body.organization_id)) {
    return NextResponse.json(
      { error: "event_id and organization_id are required" },
      { status: 400 },
    );
  }

  const status = body.outcome?.status === "failed" ? "failed" : "completed";
  const now = new Date().toISOString();
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("n8n_event_statuses")
    .upsert(
      {
        organization_id: body.organization_id,
        event_id: body.event_id,
        idempotency_key: body.idempotency_key ?? body.event_id,
        status,
        outcome: body.outcome ?? {},
        completed_at: status === "completed" ? now : null,
        failed_at: status === "failed" ? now : null,
        updated_at: now,
      },
      { onConflict: "organization_id,event_id" },
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, event_status: data });
}
