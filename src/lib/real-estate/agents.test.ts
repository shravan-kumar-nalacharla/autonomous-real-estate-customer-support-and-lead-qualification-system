import { describe, expect, it } from "vitest";
import { classifyIntent, parseRequirements } from "./agents";

describe("real-estate orchestrator routing helpers", () => {
  it("routes site visit requests to appointment handling", () => {
    expect(classifyIntent("Can I schedule a site visit this weekend?")).toBe(
      "appointment_request",
    );
  });

  it("routes legal and negotiation content to sensitive escalation", () => {
    expect(classifyIntent("I need legal help and negotiation urgently")).toBe(
      "complaint_or_sensitive",
    );
  });

  it("extracts deterministic lead requirements from customer text", () => {
    const parsed = parseRequirements(
      "Looking for 2BHK flat in Whitefield under 90 lakh this month with loan option",
      "property_search",
    );

    expect(parsed).toMatchObject({
      preferred_locations: ["Whitefield"],
      budget_max: 9000000,
      property_type: "apartment",
      bedroom_count: 2,
      listing_type: null,
      timeline: "within_1_month",
      financing_interest: true,
    });
  });
});
