import { describe, expect, it } from "vitest";
import { resolveAgentId, summarizeAgentActivity } from "./agent-team";

describe("five-agent team", () => {
  it("maps every built-in execution type to one of five visible agents", () => {
    expect([
      "orchestrator",
      "qualification",
      "property_matching",
      "appointment",
      "followup",
      "escalation",
    ].map(resolveAgentId)).toEqual([
      "concierge",
      "qualification",
      "property",
      "visit",
      "visit",
      "handoff",
    ]);
  });

  it("combines appointment and follow-up work under the appointment booking agent", () => {
    const now = "2026-07-17T10:00:00.000Z";
    const summaries = summarizeAgentActivity(
      [{
        id: "1",
        agent_type: "followup",
        action_type: "followup_task_created",
        output_summary: "Follow-up created",
        confidence: 0.8,
        created_at: now,
      }],
      [{ agent_type: "appointment" }, { agent_type: "followup" }],
    );
    const visit = summaries.find((agent) => agent.id === "visit");
    expect(visit).toMatchObject({ runs24h: 2, lastActivityAt: now });
  });
});
