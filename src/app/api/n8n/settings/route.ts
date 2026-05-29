import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

function normalizeInstanceUrl(value: string) {
  return value.replace(/\/+$/, "");
}

async function requireAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, supabase };
  return { ok: true as const, supabase };
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

export async function GET() {
  const guard = await requireAuthenticatedClient();
  if (!guard.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await getExistingSettings(guard.supabase);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data ?? null }, { status: 200 });
}

async function upsertSettings(request: Request) {
  const guard = await requireAuthenticatedClient();
  if (!guard.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        instance_url?: string | null;
        api_key?: string | null;
        is_connected?: boolean;
        last_ping_at?: string | null;
        last_ping_status?: number | null;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ("instance_url" in body) {
    const rawUrl = body.instance_url?.trim() ?? "";
    if (rawUrl && !isValidUrl(rawUrl)) {
      return NextResponse.json(
        { error: "instance_url must be a valid URL" },
        { status: 400 },
      );
    }
    updateData.instance_url = rawUrl ? normalizeInstanceUrl(rawUrl) : null;
  }

  if ("api_key" in body) {
    updateData.api_key = body.api_key?.trim() || null;
  }

  if ("is_connected" in body) {
    updateData.is_connected = Boolean(body.is_connected);
  }

  if ("last_ping_at" in body) {
    updateData.last_ping_at = body.last_ping_at ?? null;
  }

  if ("last_ping_status" in body) {
    updateData.last_ping_status =
      typeof body.last_ping_status === "number" ? body.last_ping_status : null;
  }

  const existing = await getExistingSettings(guard.supabase);
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }

  if (existing.data?.id) {
    const { data, error } = await guard.supabase
      .schema("public")
      .from("n8n_settings")
      .update(updateData)
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update settings" },
        { status: 500 },
      );
    }

    return NextResponse.json({ settings: data }, { status: 200 });
  }

  const { data, error } = await guard.supabase
    .schema("public")
    .from("n8n_settings")
    .insert(updateData)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create settings" },
      { status: 500 },
    );
  }

  return NextResponse.json({ settings: data }, { status: 201 });
}

export async function POST(request: Request) {
  return upsertSettings(request);
}

export async function PATCH(request: Request) {
  return upsertSettings(request);
}
