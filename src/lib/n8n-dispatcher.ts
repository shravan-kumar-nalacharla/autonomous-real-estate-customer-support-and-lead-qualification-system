import { createHmac, randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import type { N8nEvent, N8nWorkflowRecord } from "@/lib/n8n-types";
import { decrypt } from "@/lib/whatsapp/encryption";

export interface N8nPayload {
  organizationId: string;
  event: N8nEvent;
  entityType: string;
  entityId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  timestamp: string;
  source: "huygen-warp";
}

export interface EnqueueN8nEventInput {
  organizationId: string;
  event: N8nEvent;
  entityType: string;
  entityId?: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export async function dispatchN8nEvent(
  input: EnqueueN8nEventInput,
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("event_outbox").upsert(
    {
      organization_id: input.organizationId,
      event_type: input.event,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      idempotency_key: input.idempotencyKey,
      payload: sanitizePayload(input.payload),
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[n8n] enqueue failed:", error.message);
  }
}

export async function drainN8nOutbox(limit = 25): Promise<{
  processed: number;
  delivered: number;
  failed: number;
}> {
  const db = supabaseAdmin();
  const { data: events, error } = await db
    .from("event_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("retry_count", 6)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  if (error || !events?.length) {
    if (error) console.error("[n8n] outbox scan failed:", error.message);
    return { processed: 0, delivered: 0, failed: 0 };
  }

  let processed = 0;
  let delivered = 0;
  let failed = 0;

  for (const event of events as EventOutboxRow[]) {
    processed++;
    const claimed = await claimEvent(event.id);
    if (!claimed) continue;

    const result = await deliverEvent(event);
    if (result.ok) delivered++;
    else failed++;
  }

  return { processed, delivered, failed };
}

interface EventOutboxRow {
  id: string;
  organization_id: string;
  event_type: N8nEvent;
  entity_type: string;
  entity_id: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
  retry_count: number;
}

async function claimEvent(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("event_outbox")
    .update({ status: "delivering" })
    .eq("id", id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[n8n] outbox claim failed:", error.message);
    return false;
  }
  return Boolean(data);
}

async function deliverEvent(event: EventOutboxRow): Promise<{ ok: boolean }> {
  const db = supabaseAdmin();
  const { data: workflows, error } = await db
    .schema("public")
    .from("n8n_workflows")
    .select("*")
    .eq("organization_id", event.organization_id)
    .eq("trigger_event", event.event_type)
    .eq("is_active", true);

  if (error) {
    await failEvent(event, error.message);
    return { ok: false };
  }

  if (!workflows?.length) {
    await db
      .from("event_outbox")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", event.id);
    return { ok: true };
  }

  const timestamp = new Date().toISOString();
  const payload: N8nPayload = {
    organizationId: event.organization_id,
    event: event.event_type,
    entityType: event.entity_type,
    entityId: event.entity_id,
    idempotencyKey: event.idempotency_key,
    payload: event.payload,
    timestamp,
    source: "huygen-warp",
  };
  const rawBody = JSON.stringify(payload);

  const results = await Promise.allSettled(
    (workflows as N8nWorkflowRecord[]).map((workflow) =>
      deliverWorkflow(event, workflow, rawBody, timestamp),
    ),
  );

  const allOk = results.every(
    (result) => result.status === "fulfilled" && result.value,
  );

  if (allOk) {
    await db
      .from("event_outbox")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", event.id);
    return { ok: true };
  }

  await failEvent(event, "One or more n8n deliveries failed");
  return { ok: false };
}

async function deliverWorkflow(
  event: EventOutboxRow,
  workflow: N8nWorkflowRecord,
  rawBody: string,
  timestamp: string,
): Promise<boolean> {
  const db = supabaseAdmin();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Huygen-Timestamp": timestamp,
    "X-Huygen-Delivery-Id": randomUUID(),
    "X-Huygen-Idempotency-Key": event.idempotency_key,
  };

  if (workflow.secret_token) {
    const secret = decrypt(workflow.secret_token);
    const signature = buildN8nSignature(rawBody, secret);
    headers["X-Huygen-Signature"] = `sha256=${signature}`;
  }

  let statusCode = 0;
  let errorMessage: string | null = null;

  try {
    const response = await fetch(workflow.webhook_url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(10000),
    });
    statusCode = response.status;
    if (!response.ok) errorMessage = `HTTP ${response.status}`;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown fetch error";
  }

  await db.from("event_deliveries").upsert(
    {
      organization_id: event.organization_id,
      event_outbox_id: event.id,
      n8n_workflow_id: workflow.id,
      status: errorMessage ? "failed" : "delivered",
      attempt_count: 1,
      last_status_code: statusCode,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_outbox_id,n8n_workflow_id" },
  );

  await db
    .schema("public")
    .from("n8n_workflows")
    .update({
      last_triggered_at: new Date().toISOString(),
      last_status_code: statusCode,
      last_error: errorMessage,
      execution_count: (workflow.execution_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflow.id)
    .eq("organization_id", event.organization_id);

  return !errorMessage;
}

async function failEvent(event: EventOutboxRow, errorMessage: string) {
  const retryCount = event.retry_count + 1;
  const status = retryCount >= 6 ? "dead" : "failed";
  await supabaseAdmin()
    .from("event_outbox")
    .update({
      status,
      retry_count: retryCount,
      next_attempt_at: nextAttemptAt(retryCount).toISOString(),
      last_error: errorMessage.slice(0, 500),
    })
    .eq("id", event.id);
}

function nextAttemptAt(retryCount: number): Date {
  const delaySeconds = Math.min(3600, 2 ** retryCount * 30);
  return new Date(Date.now() + delaySeconds * 1000);
}

export function buildN8nSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    "access_token",
    "api_key",
    "authorization",
    "secret",
    "secret_token",
    "webhook_url",
  ]);
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !blocked.has(key.toLowerCase())),
  );
}
