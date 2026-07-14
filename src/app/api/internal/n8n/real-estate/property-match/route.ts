import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-secret";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { findPropertyMatches } from "@/lib/real-estate/property-matching";
import { resolveRealEstateContext } from "@/lib/real-estate/n8n-context";
import type { ParsedLeadRequirements } from "@/lib/real-estate/types";

export async function POST(request: Request) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | {
        event_id?: string;
        organization_id?: string;
        conversation_id?: string;
        contact_id?: string;
        requirements?: ParsedLeadRequirements;
        limit?: number;
      }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const db = supabaseAdmin();
  const resolved = await resolveRealEstateContext(db, body);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const requirements =
    body.requirements ??
    ((await db
      .from("lead_requirements")
      .select("*")
      .eq("organization_id", resolved.organizationId)
      .eq("contact_id", String(resolved.contact?.id ?? body.contact_id))
      .maybeSingle()).data as ParsedLeadRequirements | null);

  if (!requirements) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await findPropertyMatches({
    db,
    organizationId: resolved.organizationId,
    requirements,
    limit: Math.min(Math.max(body.limit ?? 3, 1), 3),
  });

  return NextResponse.json({ matches });
}
