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

  it("routes menu button replies without falling back to unknown", () => {
    expect(classifyIntent("Hi")).toBe("greeting");
    expect(classifyIntent("Find Property")).toBe("menu_find_property");
    expect(classifyIntent("book_site_visit")).toBe("menu_book_site_visit");
    expect(classifyIntent("3")).toBe("menu_talk_to_agent");
  });

  it("extracts plot-specific buyer requirements from natural language", () => {
    const parsed = parseRequirements(
      "Looking for 200 sq yd plot in Hyderabad under 80 lakh, east facing, can visit Sunday evening",
      "property_search",
    );

    expect(parsed).toMatchObject({
      customer_role: "buyer",
      listing_intent: "buy",
      property_category: "land",
      property_type: "plot",
      property_stage: "land_plot",
      preferred_locations: ["Hyderabad"],
      budget_max: 8000000,
      currency: "INR",
      area_min: 200,
      area_max: 200,
      area_unit: "sqyd",
      plot_facing: "east",
      site_visit_interest: true,
      preferred_appointment_time: "sunday evening",
    });
  });
});
