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

async function resolveMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const [{ data: profile }, { data: memberships, error: membershipError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("active_organization_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);

  if (membershipError) {
    return { profile, rows: [], error: membershipError };
  }

  const rows = ((memberships ?? []) as OrganizationMembership[]).sort(roleSort);
  return { profile, rows, error: null };
}

function selectMembership(
  profile: unknown,
  rows: OrganizationMembership[],
) {
  const activeOrg = (profile as { active_organization_id?: string | null } | null)
    ?.active_organization_id;
  return rows.find((row) => row.organization_id === activeOrg) ?? rows[0];
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

  let { profile, rows, error: membershipError } = await resolveMembership(
    supabase,
    user.id,
  );

  if (membershipError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to resolve organization" },
        { status: 500 },
      ),
    };
  }

  let membership = selectMembership(profile, rows);

  if (!membership) {
    const { error: ensureError } = await supabase.rpc("ensure_user_organization", {
      p_user_id: user.id,
    });

    if (!ensureError) {
      const refreshed = await resolveMembership(supabase, user.id);
      profile = refreshed.profile;
      rows = refreshed.rows;
      membershipError = refreshed.error;
      membership = selectMembership(profile, rows);
    }

    if (ensureError || membershipError || !membership) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "No active organization membership. Run the latest Supabase migrations or create an organization membership for this user.",
          },
          { status: 403 },
        ),
      };
    }
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
