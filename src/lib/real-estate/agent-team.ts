export const AGENT_TEAM = [
  {
    id: "concierge",
    name: "Concierge Agent",
    shortName: "Concierge",
    description: "Understands each enquiry and routes it to the right specialist.",
    capabilities: ["Intent detection", "Conversation routing", "Safety checks"],
    activityTypes: ["orchestrator"],
  },
  {
    id: "qualification",
    name: "Lead Qualification Agent",
    shortName: "Qualifier",
    description: "Captures requirements and scores buyer, renter, and seller intent.",
    capabilities: ["Requirement extraction", "Lead scoring", "Hot-lead detection"],
    activityTypes: ["qualification"],
  },
  {
    id: "property",
    name: "Property Match Agent",
    shortName: "Matcher",
    description: "Ranks available listings against budget, location, and property needs.",
    capabilities: ["Inventory search", "Match ranking", "Recommendations"],
    activityTypes: ["property_matching"],
  },
  {
    id: "visit",
    name: "Appointment Booking Agent",
    shortName: "Scheduler",
    description: "Books property visits, records preferred times, and keeps confirmations moving.",
    capabilities: ["Visit requests", "Follow-up tasks", "Schedule coordination"],
    activityTypes: ["appointment", "followup"],
  },
  {
    id: "handoff",
    name: "Human Handoff Agent",
    shortName: "Handoff",
    description: "Escalates sensitive or high-value conversations to the best human agent.",
    capabilities: ["Risk detection", "Load-balanced assignment", "Human escalation"],
    activityTypes: ["escalation"],
  },
] as const;

export type AgentDefinition = (typeof AGENT_TEAM)[number];
export type AgentId = AgentDefinition["id"];

export interface AgentActivityRow {
  id: string;
  agent_type: string;
  action_type: string;
  output_summary: string | null;
  confidence: number | null;
  created_at: string;
}

export interface AgentRuntimeSummary {
  id: AgentId;
  runs24h: number;
  lastActivityAt: string | null;
  lastAction: string | null;
  lastOutput: string | null;
  confidence: number | null;
}

export function resolveAgentId(agentType: string): AgentId | null {
  return (
    AGENT_TEAM.find((agent) =>
      (agent.activityTypes as readonly string[]).includes(agentType),
    )?.id ?? null
  );
}

export function summarizeAgentActivity(
  recentRows: AgentActivityRow[],
  rows24h: Pick<AgentActivityRow, "agent_type">[],
): AgentRuntimeSummary[] {
  return AGENT_TEAM.map((agent) => {
    const types = agent.activityTypes as readonly string[];
    const latest = recentRows.find((row) => types.includes(row.agent_type));
    return {
      id: agent.id,
      runs24h: rows24h.filter((row) => types.includes(row.agent_type)).length,
      lastActivityAt: latest?.created_at ?? null,
      lastAction: latest?.action_type ?? null,
      lastOutput: latest?.output_summary ?? null,
      confidence: latest?.confidence ?? null,
    };
  });
}
