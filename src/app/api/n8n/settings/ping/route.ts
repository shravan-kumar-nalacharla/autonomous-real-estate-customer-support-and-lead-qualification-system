import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_N8N_INSTANCE_URL } from "@/lib/n8n-types";
import {
  getFallbackSettings,
  isMissingN8nTableError,
  upsertFallbackSettings,
} from "@/lib/n8n-fallback-store";

function normalizeInstanceUrl(value: string) {
  return value.replace(/\/+$/, "");
}

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
  return { ok: true as const, supabase, user };
}

async function getExistingSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const { data, error } = await supabase
    .schema("public")
    .from("n8n_settings")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

async function pingUrl(
  url: string,
  apiKey: string | null | undefined,
): Promise<{ ok: boolean; status: number }> {
  const headers: Record<string, string> = {};
  if (apiKey) {
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
  const guard = await requireAuthenticatedClient();
  if (!guard.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    instance_url?: string;
  };

  const existing = await getExistingSettings(guard.supabase);
  let existingSettings = existing.data;
  if (existing.error) {
    if (!isMissingN8nTableError(existing.error)) {
      return NextResponse.json({ error: existing.error.message }, { status: 500 });
    }
    try {
      existingSettings = await getFallbackSettings(guard.supabase, guard.user.id);
    } catch (fallbackError) {
      return NextResponse.json(
        {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : "Failed to load settings",
        },
        { status: 500 },
      );
    }
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
    : await guard.supabase
        .schema("public")
        .from("n8n_settings")
        .insert(updateData);

  if (persistResult.error) {
    if (!isMissingN8nTableError(persistResult.error)) {
      return NextResponse.json(
        { error: persistResult.error.message },
        { status: 500 },
      );
    }
    try {
      await upsertFallbackSettings(guard.supabase, guard.user.id, {
        instance_url: instanceUrl,
        is_connected: connected,
        last_ping_at: new Date().toISOString(),
        last_ping_status: statusCode,
      });
    } catch (fallbackError) {
      return NextResponse.json(
        {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : "Failed to persist connection status",
        },
        { status: 500 },
      );
    }
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
