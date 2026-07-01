import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type OrganizationRole = "owner" | "admin" | "manager" | "agent";

export interface OrganizationMembership {
  organization_id: string;
  role: OrganizationRole;
}

export interface OrganizationContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  organizationId: string;
  role: OrganizationRole;
}

export type OrganizationGuard =
  | ({ ok: true } & OrganizationContext)
  | { ok: false; response: NextResponse };

const ROLE_RANK: Record<OrganizationRole, number> = {
  owner: 0,
  admin: 1,
  manager: 2,
  agent: 3,
};

function roleSort(a: OrganizationMembership, b: OrganizationMembership) {
  return ROLE_RANK[a.role] - ROLE_RANK[b.role];
}

function hasAnyRole(role: OrganizationRole, allowed: readonly OrganizationRole[]) {
  return allowed.includes(role);
}

export async function requireOrganizationContext(
  allowedRoles?: readonly OrganizationRole[],
): Promise<OrganizationGuard> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const [{ data: profile }, { data: memberships, error: membershipError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("active_organization_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)
        .eq("status", "active"),
    ]);

  if (membershipError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to resolve organization" },
        { status: 500 },
      ),
    };
  }

  const rows = ((memberships ?? []) as OrganizationMembership[]).sort(roleSort);
  const activeOrg = (profile as { active_organization_id?: string | null } | null)
    ?.active_organization_id;
  const membership =
    rows.find((row) => row.organization_id === activeOrg) ?? rows[0];

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No active organization membership" },
        { status: 403 },
      ),
    };
  }

  if (allowedRoles && !hasAnyRole(membership.role, allowedRoles)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    supabase,
    user,
    organizationId: membership.organization_id,
    role: membership.role,
  };
}

export async function getUserOrganizationIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return ((data ?? []) as Array<{ organization_id: string }>).map(
    (row) => row.organization_id,
  );
}

