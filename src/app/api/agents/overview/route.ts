import { NextResponse } from "next/server";
import { requireOrganizationContext } from "@/lib/organizations";
import {
  resolveAgentId,
  summarizeAgentActivity,
  type AgentActivityRow,
} from "@/lib/real-estate/agent-team";

export async function GET() {
  const guard = await requireOrganizationContext();
  if (!guard.ok) return guard.response;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [recentResult, dayResult] = await Promise.all([
    guard.supabase
      .from("agent_activity_logs")
      .select("id, agent_type, action_type, output_summary, confidence, created_at")
      .eq("organization_id", guard.organizationId)
      .order("created_at", { ascending: false })
      .limit(60),
    guard.supabase
      .from("agent_activity_logs")
      .select("agent_type")
      .eq("organization_id", guard.organizationId)
      .gte("created_at", since)
      .limit(5000),
  ]);

  if (recentResult.error || dayResult.error) {
    return NextResponse.json(
      { error: recentResult.error?.message ?? dayResult.error?.message },
      { status: 500 },
    );
  }

  const recent = (recentResult.data ?? []) as AgentActivityRow[];
  const timeline = recent
    .map((row) => ({ ...row, agentId: resolveAgentId(row.agent_type) }))
    .filter((row) => row.agentId !== null)
    .slice(0, 12);

  return NextResponse.json({
    agents: summarizeAgentActivity(
      recent,
      (dayResult.data ?? []) as Pick<AgentActivityRow, "agent_type">[],
    ),
    timeline,
    generatedAt: new Date().toISOString(),
  });
}
