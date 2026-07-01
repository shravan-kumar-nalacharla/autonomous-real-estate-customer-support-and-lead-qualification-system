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
});
