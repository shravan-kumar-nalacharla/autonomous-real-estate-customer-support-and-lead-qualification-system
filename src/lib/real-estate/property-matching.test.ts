import { describe, expect, it } from "vitest";
import { findPropertyMatches } from "./property-matching";

describe("findPropertyMatches", () => {
  it("returns top available organization-owned matches", async () => {
    const db = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          limit: async () => ({
            data: [
              {
                id: "p1",
                title: "2BHK Whitefield",
                property_type: "apartment",
                listing_type: "sale",
                location: "Whitefield",
                locality: "Kadugodi",
                bedrooms: 2,
                price: 8500000,
              },
              {
                id: "p2",
                title: "Villa North",
                property_type: "villa",
                listing_type: "sale",
                location: "Hebbal",
                locality: null,
                bedrooms: 4,
                price: 30000000,
              },
            ],
            error: null,
          }),
        };
      },
    };

    const matches = await findPropertyMatches({
      db: db as never,
      organizationId: "org-1",
      requirements: {
        preferred_locations: ["Whitefield"],
        budget_max: 9000000,
        property_type: "apartment",
        bedroom_count: 2,
        listing_type: "sale",
      },
    });

    expect(matches[0]).toMatchObject({
      property_id: "p1",
      match_score: 100,
    });
    expect(matches[0].matching_reasons).toContain("is in Whitefield");
  });

  it("scores land plot requirements without exposing owner fields", async () => {
    const db = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          limit: async () => ({
            data: [
              {
                id: "plot-1",
                title: "East-facing plot",
                property_type: "plot",
                listing_type: "sale",
                listing_intent: "buy",
                property_category: "land",
                property_stage: "land_plot",
                location: "Hyderabad",
                locality: "Tellapur",
                city: "Hyderabad",
                bedrooms: null,
                bathrooms: null,
                area_sqft: null,
                area_min: 200,
                area_max: 200,
                area_unit: "sq_yd",
                price: 7900000,
                owner_phone: "should-not-leak",
              },
            ],
            error: null,
          }),
        };
      },
    };

    const matches = await findPropertyMatches({
      db: db as never,
      organizationId: "org-1",
      requirements: {
        listing_intent: "buy",
        property_category: "land",
        property_type: "plot",
        property_stage: "land_plot",
        preferred_locations: ["Hyderabad"],
        budget_max: 8000000,
        area_min: 180,
        area_max: 220,
        area_unit: "sq_yd",
      },
    });

    expect(matches[0].property_id).toBe("plot-1");
    expect(matches[0].match_score).toBeGreaterThan(80);
    expect(matches[0].property).not.toHaveProperty("owner_phone");
    expect(matches[0].matching_reasons).toContain("matches land category");
  });
});
