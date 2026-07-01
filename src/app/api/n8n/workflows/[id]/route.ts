import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import {
  N8N_TRIGGER_EVENTS,
  isN8nEvent,
  toSafeWorkflow,
  type N8nWorkflowRecord,
} from "@/lib/n8n-types";
import { encrypt } from "@/lib/whatsapp/encryption";

const ALLOWED_PATCH_FIELDS = new Set([
  "name",
  "description",
  "webhook_url",
  "is_active",
  "trigger_event",
  "secret_token",
  "workflow_id",
  "n8n_instance_url",
]);

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.host);
  } catch {
    return false;
  }
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", guard.organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  return NextResponse.json({
    workflow: toSafeWorkflow(data as N8nWorkflowRecord),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) continue;

    if (key === "name") {
      const name = String(value ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      updateData.name = name;
      continue;
    }

    if (key === "webhook_url") {
      const webhookUrl = String(value ?? "").trim();
      if (!isValidUrl(webhookUrl)) {
        return NextResponse.json(
          { error: "webhook_url must be a valid HTTPS URL" },
          { status: 400 },
        );
      }
      updateData.webhook_url = webhookUrl;
      continue;
    }

    if (key === "trigger_event") {
      const triggerEvent = String(value ?? "").trim();
      if (!isN8nEvent(triggerEvent)) {
        return NextResponse.json(
          { error: "trigger_event is invalid", allowed: N8N_TRIGGER_EVENTS },
          { status: 400 },
        );
      }
      updateData.trigger_event = triggerEvent;
      continue;
    }

    if (key === "is_active") {
      updateData.is_active = Boolean(value);
      continue;
    }

    if (key === "secret_token") {
      const trimmed = typeof value === "string" ? value.trim() : "";
      updateData.secret_token = trimmed ? encrypt(trimmed) : null;
      continue;
    }

    if (key === "description" || key === "workflow_id" || key === "n8n_instance_url") {
      const trimmed = typeof value === "string" ? value.trim() : "";
      updateData[key] = trimmed || null;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields provided for update" },
      { status: 400 },
    );
  }

  updateData.updated_at = new Date().toISOString();

  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", guard.organizationId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  return NextResponse.json({
    workflow: toSafeWorkflow(data as N8nWorkflowRecord),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .delete()
    .eq("id", id)
    .eq("organization_id", guard.organizationId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
