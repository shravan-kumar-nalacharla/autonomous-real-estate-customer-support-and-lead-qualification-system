import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { N8N_TRIGGER_EVENTS, isN8nEvent } from "@/lib/n8n-types";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

async function requireAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, supabase };
  return { ok: true as const, supabase };
}

export async function GET() {
  const guard = await requireAuthenticatedClient();
  if (!guard.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await guard.supabase
    .from("n8n_workflows")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ workflows: data ?? [] }, { status: 200 });
}

export async function POST(request: Request) {
  const guard = await requireAuthenticatedClient();
  if (!guard.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        description?: string | null;
        workflow_id?: string | null;
        webhook_url?: string;
        trigger_event?: string;
        is_active?: boolean;
        n8n_instance_url?: string | null;
        secret_token?: string | null;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const webhookUrl = body.webhook_url?.trim();
  const triggerEvent = body.trigger_event?.trim() ?? "message.received";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!webhookUrl || !isValidUrl(webhookUrl)) {
    return NextResponse.json(
      { error: "webhook_url must be a valid URL" },
      { status: 400 },
    );
  }

  if (!isN8nEvent(triggerEvent)) {
    return NextResponse.json(
      {
        error: "trigger_event is invalid",
        allowed: N8N_TRIGGER_EVENTS,
      },
      { status: 400 },
    );
  }

  const { data, error } = await guard.supabase
    .from("n8n_workflows")
    .insert({
      name,
      description: body.description?.trim() || null,
      workflow_id: body.workflow_id?.trim() || null,
      webhook_url: webhookUrl,
      trigger_event: triggerEvent,
      is_active: body.is_active ?? true,
      n8n_instance_url: body.n8n_instance_url?.trim() || null,
      secret_token: body.secret_token?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create workflow" },
      { status: 500 },
    );
  }

  return NextResponse.json({ workflow: data }, { status: 201 });
}
