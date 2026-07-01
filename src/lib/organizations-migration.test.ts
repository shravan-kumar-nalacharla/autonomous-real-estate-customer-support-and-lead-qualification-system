import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260701000000_organizations_real_estate.sql"),
  "utf8",
);

describe("organization tenancy migration", () => {
  it("defines membership helpers with safe search_path", () => {
    expect(migration).toContain("public.is_organization_member");
    expect(migration).toContain("public.has_organization_role");
    expect(migration).toContain("SET search_path = public");
  });

  it("replaces global n8n policies with organization-aware policies", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "authenticated users manage n8n_workflows"',
    );
    expect(migration).toContain("public.is_organization_member(organization_id)");
    expect(migration).toContain("organization_id IS NOT NULL");
  });

  it("adds organization scoped real-estate tables", () => {
    for (const table of [
      "properties",
      "lead_requirements",
      "lead_scores",
      "appointments",
      "follow_up_tasks",
      "agent_activity_logs",
      "event_outbox",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
