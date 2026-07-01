import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import {
  N8N_TRIGGER_EVENTS,
  isN8nEvent,
  toSafeWorkflow,
  type N8nWorkflowRecord,
} from "@/lib/n8n-types";
import { encrypt } from "@/lib/whatsapp/encryption";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.host);
  } catch {
    return false;
  }
}

type WorkflowBody = {
  name?: string;
  description?: string | null;
  workflow_id?: string | null;
  webhook_url?: string;
  trigger_event?: string;
  is_active?: boolean;
  n8n_instance_url?: string | null;
  secret_token?: string | null;
};

function parseWorkflowBody(raw: unknown): WorkflowBody | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as WorkflowBody;
}

export async function GET() {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .select("*")
    .eq("organization_id", guard.organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    workflows: ((data ?? []) as N8nWorkflowRecord[]).map(toSafeWorkflow),
  });
}

export async function POST(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

  const body = parseWorkflowBody(await request.json().catch(() => null));
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
      { error: "webhook_url must be a valid HTTPS URL" },
      { status: 400 },
    );
  }
  if (!isN8nEvent(triggerEvent)) {
    return NextResponse.json(
      { error: "trigger_event is invalid", allowed: N8N_TRIGGER_EVENTS },
      { status: 400 },
    );
  }

  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .insert({
      organization_id: guard.organizationId,
      name,
      description: body.description?.trim() || null,
      workflow_id: body.workflow_id?.trim() || null,
      webhook_url: webhookUrl,
      trigger_event: triggerEvent,
      is_active: body.is_active ?? true,
      n8n_instance_url: body.n8n_instance_url?.trim() || null,
      secret_token: body.secret_token?.trim()
        ? encrypt(body.secret_token.trim())
        : null,
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

  return NextResponse.json(
    { workflow: toSafeWorkflow(data as N8nWorkflowRecord) },
    { status: 201 },
  );
}
