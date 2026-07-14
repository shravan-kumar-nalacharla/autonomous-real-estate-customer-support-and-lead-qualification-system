import { describe, expect, it } from "vitest";
import {
  buildRealEstateConversationReply,
  hasMeaningfulRequirements,
  normalizeCustomerIntent,
} from "./conversation-policy";

describe("real-estate conversation policy", () => {
  it("sends the welcome menu only when a greeting has no recent menu", () => {
    const first = buildRealEstateConversationReply({
      agencyName: "Huygen Realty",
      messageText: "Hi",
      memory: { last_agent_menu_sent_recently: false },
    });

    expect(first).toMatchObject({
      intent: "greeting",
      messageType: "interactive",
      buttons: [
        { id: "find_property", title: "Find Property" },
        { id: "book_site_visit", title: "Book Site Visit" },
        { id: "talk_to_agent", title: "Talk to Agent" },
      ],
    });

    const repeat = buildRealEstateConversationReply({
      agencyName: "Huygen Realty",
      messageText: "hello",
      memory: { last_agent_menu_sent_recently: true },
    });

    expect(repeat.messageType).toBe("text");
    expect(repeat.reply).toContain("please choose one of the options above");
    expect(repeat.buttons).toHaveLength(0);
  });

  it("turns Find Property button taps into the next qualification question", () => {
    const result = buildRealEstateConversationReply({
      agencyName: "Huygen Realty",
      interactiveReplyId: "find_property",
    });

    expect(result).toMatchObject({
      intent: "menu_find_property",
      messageType: "interactive",
      reply: "Great. Are you looking to buy, rent, sell, or lease?",
    });
    expect(result.buttons.map((button) => button.title)).toEqual([
      "Buy",
      "Rent",
      "Sell/Lease",
    ]);
  });

  it("normalizes numeric menu replies", () => {
    expect(normalizeCustomerIntent({ messageText: "1" })).toBe("menu_find_property");
    expect(normalizeCustomerIntent({ messageText: "2" })).toBe("menu_book_site_visit");
    expect(normalizeCustomerIntent({ messageText: "3" })).toBe("menu_talk_to_agent");
  });

  it("asks for property context before booking a site visit", () => {
    const result = buildRealEstateConversationReply({
      agencyName: "Huygen Realty",
      interactiveReplyId: "book_site_visit",
      requirements: {},
      propertyMatches: [],
    });

    expect(result.reply).toContain("Which property would you like to visit");
    expect(result.requiresHuman).toBe(false);
  });

  it("creates a handoff reply for Talk to Agent", () => {
    const result = buildRealEstateConversationReply({
      agencyName: "Huygen Realty",
      interactiveReplyId: "talk_to_agent",
    });

    expect(result.requiresHuman).toBe(true);
    expect(result.reply).toContain("advisor will assist you shortly");
  });

  it("recognizes meaningful land/plot requirements", () => {
    expect(
      hasMeaningfulRequirements({
        listing_intent: "buy",
        property_category: "land",
        property_type: "plot",
        preferred_locations: ["Hyderabad"],
        budget_max: 8000000,
        area_max: 200,
        area_unit: "sqyd",
        site_visit_interest: true,
      }),
    ).toBe(true);
  });
});
