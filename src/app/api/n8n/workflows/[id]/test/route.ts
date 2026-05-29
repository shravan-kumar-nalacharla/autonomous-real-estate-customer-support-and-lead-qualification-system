import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { N8nWorkflowRecord } from "@/lib/n8n-types";

async function requireAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, supabase };
  return { ok: true as const, supabase };
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthenticatedClient();
  if (!guard.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_workflows")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const workflow = data as N8nWorkflowRecord;
  const payload = {
    event: workflow.trigger_event,
    test: true,
    payload: {
      contactId: "test-contact-123",
      message: "Test ping from Huygen Warp",
      customerPhone: "919999999999",
      source: "huygen-warp-test",
    },
    timestamp: new Date().toISOString(),
    source: "huygen-warp",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (workflow.secret_token) {
    const signature = createHmac("sha256", workflow.secret_token)
      .update(JSON.stringify(payload))
      .digest("hex");
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
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    statusCode = response.status;
    success = response.ok;
    message = response.ok
      ? `n8n responded ${response.status}`
      : `n8n returned ${response.status}`;
    if (!response.ok) lastError = message;
  } catch (fetchError) {
    statusCode = 0;
    success = false;
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
    .eq("id", workflow.id);

  return NextResponse.json(
    { success, status: statusCode, message },
    { status: success ? 200 : 502 },
  );
}
