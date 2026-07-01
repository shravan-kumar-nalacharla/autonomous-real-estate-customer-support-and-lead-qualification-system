import { describe, expect, it } from "vitest";
import { scoreLead } from "./lead-scoring";

describe("scoreLead", () => {
  it("classifies complete site-visit leads as hot with an explanation", () => {
    const result = scoreLead({
      preferred_locations: ["Whitefield"],
      budget_max: 9000000,
      property_type: "apartment",
      timeline: "within_1_month",
      site_visit_interest: true,
      hasVerifiedContact: true,
    });

    expect(result.score).toBe(100);
    expect(result.category).toBe("hot");
    expect(result.breakdown).toMatchObject({
      preferred_location: 15,
      budget: 20,
      property_type: 15,
      timeline: 20,
      site_visit_requested: 20,
      verified_contact: 10,
    });
    expect(result.explanation).toContain("preferred location");
  });

  it("classifies insufficient detail as a general enquiry", () => {
    const result = scoreLead({});

    expect(result.score).toBe(0);
    expect(result.category).toBe("general_enquiry");
    expect(result.explanation).toContain("Insufficient");
  });

  it("uses warm and cold boundaries", () => {
    expect(
      scoreLead({ budget_max: 5000000, property_type: "villa" }).category,
    ).toBe("cold");
    expect(
      scoreLead({
        budget_max: 5000000,
        property_type: "villa",
        timeline: "within_3_months",
      }).category,
    ).toBe("warm");
  });
});
