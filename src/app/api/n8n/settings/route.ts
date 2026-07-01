import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOrganizationContext } from "@/lib/organizations";
import { toSafeSettings, type N8nSettingsRecord } from "@/lib/n8n-types";
import { encrypt } from "@/lib/whatsapp/encryption";

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.host);
  } catch {
    return false;
  }
}

function normalizeInstanceUrl(value: string) {
  return value.replace(/\/+$/, "");
}

async function getExistingSettings(
  supabase: SupabaseClient,
  organizationId: string,
) {
  return supabase
    .schema("public")
    .from("n8n_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
}

export async function GET() {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const { data, error } = await getExistingSettings(
    guard.supabase,
    guard.organizationId,
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    settings: data ? toSafeSettings(data as N8nSettingsRecord) : null,
  });
}

async function upsertSettings(request: Request) {
  const guard = await requireOrganizationContext(["owner", "admin", "manager"]);
  if (!guard.ok) return guard.response;

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
    organization_id: guard.organizationId,
    updated_at: new Date().toISOString(),
  };

  if ("instance_url" in body) {
    const rawUrl = body.instance_url?.trim() ?? "";
    if (rawUrl && !isValidUrl(rawUrl)) {
      return NextResponse.json(
        { error: "instance_url must be a valid HTTPS URL" },
        { status: 400 },
      );
    }
    updateData.instance_url = rawUrl ? normalizeInstanceUrl(rawUrl) : null;
  }

  if ("api_key" in body) {
    const rawKey = body.api_key?.trim() ?? "";
    updateData.api_key = rawKey ? encrypt(rawKey) : null;
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

  const existing = await getExistingSettings(
    guard.supabase,
    guard.organizationId,
  );
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }

  const query = existing.data?.id
    ? guard.supabase
        .schema("public")
        .from("n8n_settings")
        .update(updateData)
        .eq("id", existing.data.id)
        .eq("organization_id", guard.organizationId)
    : guard.supabase
        .schema("public")
        .from("n8n_settings")
        .insert(updateData);

  const { data, error } = await query.select("*").single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save settings" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    settings: toSafeSettings(data as N8nSettingsRecord),
  });
}

export async function POST(request: Request) {
  return upsertSettings(request);
}

export async function PATCH(request: Request) {
  return upsertSettings(request);
}
