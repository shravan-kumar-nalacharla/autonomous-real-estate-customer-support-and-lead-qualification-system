import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import { DEFAULT_N8N_INSTANCE_URL } from "@/lib/n8n-types";
import { decrypt } from "@/lib/whatsapp/encryption";

function normalizeInstanceUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.host);
  } catch {
    return false;
  }
}

async function pingUrl(
  url: string,
  encryptedApiKey: string | null | undefined,
): Promise<{ ok: boolean; status: number }> {
  const headers: Record<string, string> = {};
  if (encryptedApiKey) {
    const apiKey = decrypt(encryptedApiKey);
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-N8N-API-KEY"] = apiKey;
  }
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10000),
  });
  return { ok: response.ok, status: response.status };
}

export async function POST(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    instance_url?: string;
  };

  const { data: existingSettings, error } = await guard.supabase
    .schema("public")
    .from("n8n_settings")
    .select("*")
    .eq("organization_id", guard.organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const inputUrl = body.instance_url?.trim();
  const candidateUrl =
    inputUrl || existingSettings?.instance_url || DEFAULT_N8N_INSTANCE_URL;
  const instanceUrl = normalizeInstanceUrl(candidateUrl);

  if (!isValidUrl(instanceUrl)) {
    return NextResponse.json(
      { error: "instance_url is missing or invalid" },
      { status: 400 },
    );
  }

  let statusCode = 0;
  let connected = false;
  let message = "Unreachable";

  try {
    const healthResult = await pingUrl(
      `${instanceUrl}/healthz`,
      existingSettings?.api_key,
    );
    statusCode = healthResult.status;
    connected = healthResult.ok || (statusCode > 0 && statusCode < 500);

    if (!connected) {
      const workflowsResult = await pingUrl(
        `${instanceUrl}/api/v1/workflows`,
        existingSettings?.api_key,
      );
      statusCode = workflowsResult.status;
      connected =
        workflowsResult.ok || (statusCode > 0 && workflowsResult.status < 500);
    }

    message = connected ? "Connected" : "Unreachable";
  } catch (error) {
    statusCode = 0;
    connected = false;
    message = error instanceof Error ? error.message : "Unable to connect";
  }

  const updateData = {
    organization_id: guard.organizationId,
    instance_url: instanceUrl,
    is_connected: connected,
    last_ping_at: new Date().toISOString(),
    last_ping_status: statusCode,
    updated_at: new Date().toISOString(),
  };

  const persistResult = existingSettings?.id
    ? await guard.supabase
        .schema("public")
        .from("n8n_settings")
        .update(updateData)
        .eq("id", existingSettings.id)
        .eq("organization_id", guard.organizationId)
    : await guard.supabase
        .schema("public")
        .from("n8n_settings")
        .insert(updateData);

  if (persistResult.error) {
    return NextResponse.json(
      { error: persistResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      success: connected,
      connected,
      status: statusCode,
      message,
      instance_url: instanceUrl,
    },
    { status: connected ? 200 : 502 },
  );
}
