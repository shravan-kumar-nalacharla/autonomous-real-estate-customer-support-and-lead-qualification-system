import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import type { N8nWorkflowRecord } from "@/lib/n8n-types";
import { decrypt } from "@/lib/whatsapp/encryption";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
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

  const workflow = data as N8nWorkflowRecord;
  const timestamp = new Date().toISOString();
  const payload = {
    organizationId: guard.organizationId,
    event: workflow.trigger_event,
    test: true,
    payload: {
      source: "huygen-warp-test",
      message: "Test ping from Huygen Warp",
    },
    timestamp,
    source: "huygen-warp",
  };
  const rawBody = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Huygen-Timestamp": timestamp,
  };

  if (workflow.secret_token) {
    const secret = decrypt(workflow.secret_token);
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    headers["X-Huygen-Signature"] = `sha256=${signature}`;
  }

  let statusCode = 0;
  let success = false;
  let message = "Unable to reach n8n webhook";
  let lastError: string | null = null;

  try {
    const response = await fetch(workflow.webhook_url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(10000),
    });
    statusCode = response.status;
    success = response.ok;
    message = response.ok
      ? `n8n responded ${response.status}`
      : `n8n returned ${response.status}`;
    if (!response.ok) lastError = message;
  } catch (fetchError) {
    lastError =
      fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
    message = lastError;
  }

  await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .update({
      last_triggered_at: new Date().toISOString(),
      last_status_code: statusCode,
      last_error: lastError,
      execution_count: (workflow.execution_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflow.id)
    .eq("organization_id", guard.organizationId);

  return NextResponse.json(
    { success, status: statusCode, message },
    { status: success ? 200 : 502 },
  );
}
