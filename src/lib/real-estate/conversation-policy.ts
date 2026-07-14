import type { ParsedLeadRequirements, RealEstateIntent } from "./types";

export interface SuggestedButton {
  id: string;
  title: string;
}

export interface ConversationMemory {
  last_agent_message_text: string | null;
  last_agent_intent: string | null;
  last_agent_menu_sent_at: string | null;
  last_agent_menu_sent_recently: boolean;
  last_customer_message_text: string | null;
  last_customer_interactive_reply_id: string | null;
}

export interface ConversationPolicyInput {
  agencyName: string;
  messageText?: string | null;
  interactiveReplyId?: string | null;
  memory?: Partial<ConversationMemory> | null;
  requirements?: ParsedLeadRequirements | null;
  propertyMatches?: Array<Record<string, unknown>>;
}

export interface ConversationPolicyResult {
  intent: RealEstateIntent;
  messageType: "text" | "interactive";
  reply: string;
  buttons: SuggestedButton[];
  requiresHuman: boolean;
}

const WELCOME_BUTTONS: SuggestedButton[] = [
  { id: "find_property", title: "Find Property" },
  { id: "book_site_visit", title: "Book Site Visit" },
  { id: "talk_to_agent", title: "Talk to Agent" },
];

const INTENT_BUTTONS: SuggestedButton[] = [
  { id: "buy", title: "Buy" },
  { id: "rent", title: "Rent" },
  { id: "sell_lease", title: "Sell/Lease" },
];

export function normalizeCustomerIntent(args: {
  messageText?: string | null;
  interactiveReplyId?: string | null;
}): RealEstateIntent {
  const raw = normalizeAction(args.interactiveReplyId || args.messageText || "");
  if (/^(hi|hello|hey|good morning|good evening|good afternoon|namaste)$/.test(raw)) {
    return "greeting";
  }
  if (/^(find property|find_property|property search|1)$/.test(raw)) {
    return "menu_find_property";
  }
  if (/^(book site visit|book_site_visit|site visit|2)$/.test(raw)) {
    return "menu_book_site_visit";
  }
  if (/^(talk to agent|talk_to_agent|human|agent|3)$/.test(raw)) {
    return "menu_talk_to_agent";
  }
  if (/\b(plot|flat|villa|bhk|buy|rent|lease|sell|budget|looking for|sq\s?yd|sqft)\b/.test(raw)) {
    return "property_search";
  }
  return raw ? "general_enquiry" : "unknown";
}

export function hasMeaningfulRequirements(requirements?: ParsedLeadRequirements | null) {
  if (!requirements) return false;
  return Boolean(
    (requirements.listing_intent && requirements.listing_intent !== "unknown") ||
      (requirements.property_category && requirements.property_category !== "unknown") ||
      (requirements.property_type && requirements.property_type !== "unknown") ||
      requirements.preferred_locations?.length ||
      requirements.budget_min ||
      requirements.budget_max ||
      requirements.area_min ||
      requirements.area_max ||
      requirements.bedrooms ||
      requirements.bedroom_count ||
      requirements.site_visit_interest === true,
  );
}

export function buildRealEstateConversationReply(
  input: ConversationPolicyInput,
): ConversationPolicyResult {
  const intent = normalizeCustomerIntent({
    messageText: input.messageText,
    interactiveReplyId: input.interactiveReplyId,
  });
  const requirements = input.requirements ?? {};
  const propertyMatches = input.propertyMatches ?? [];

  if (intent === "greeting") {
    if (input.memory?.last_agent_menu_sent_recently) {
      return {
        intent,
        messageType: "text",
        reply:
          "Sure - please choose one of the options above, or tell me what you need, for example: \"200 sq yd plot in Hyderabad under 80 lakh\".",
        buttons: [],
        requiresHuman: false,
      };
    }
    return {
      intent,
      messageType: "interactive",
      reply: `Welcome to ${input.agencyName}. I can help you buy, rent, sell, or book a site visit.\n\nWhat are you looking for today?`,
      buttons: WELCOME_BUTTONS,
      requiresHuman: false,
    };
  }

  if (intent === "menu_find_property") {
    return {
      intent,
      messageType: "interactive",
      reply: "Great. Are you looking to buy, rent, sell, or lease?",
      buttons: INTENT_BUTTONS,
      requiresHuman: false,
    };
  }

  if (intent === "menu_book_site_visit") {
    const hasReference = Boolean(requirements.property_reference || propertyMatches.length);
    return {
      intent,
      messageType: "text",
      reply: hasReference
        ? "What day and time works for your site visit?"
        : "Sure. Which property would you like to visit? You can send the property name/reference, or first tell me your preferred location and budget.",
      buttons: [],
      requiresHuman: false,
    };
  }

  if (intent === "menu_talk_to_agent") {
    return {
      intent,
      messageType: "text",
      reply: "I've notified our team. A real-estate advisor will assist you shortly.",
      buttons: [],
      requiresHuman: true,
    };
  }

  if (hasMeaningfulRequirements(requirements)) {
    return {
      intent,
      messageType: "text",
      reply: buildRequirementReply(requirements, propertyMatches),
      buttons: [],
      requiresHuman: false,
    };
  }

  return {
    intent,
    messageType: "text",
    reply:
      "Tell me what you are looking for - property type, location, budget, and whether you want to buy, rent, sell, or book a visit.",
    buttons: [],
    requiresHuman: false,
  };
}

function buildRequirementReply(
  requirements: ParsedLeadRequirements,
  propertyMatches: Array<Record<string, unknown>>,
) {
  if (propertyMatches.length > 0) {
    const lines = propertyMatches.slice(0, 3).map((match, index) => {
      const title = String(match.title ?? match.property_title ?? `Option ${index + 1}`);
      const locality = String(match.locality ?? match.location ?? match.city ?? "");
      const price = match.price ? ` - ${String(match.price)}` : "";
      return `${index + 1}. ${title}${locality ? ` - ${locality}` : ""}${price}`;
    });
    return `I found a few options that may fit:\n\n${lines.join("\n")}\n\nWould you like to book a site visit for one of these?`;
  }

  const parts = [
    requirements.area_max && requirements.area_unit
      ? `${requirements.area_max} ${requirements.area_unit}`
      : null,
    requirements.plot_facing ? `${requirements.plot_facing.replace(/_/g, " ")}-facing` : null,
    requirements.property_type && requirements.property_type !== "unknown"
      ? requirements.property_type
      : null,
    requirements.preferred_locations?.length
      ? `in ${requirements.preferred_locations.join(", ")}`
      : null,
    requirements.budget_max ? `under Rs ${formatIndianNumber(requirements.budget_max)}` : null,
  ].filter(Boolean);

  const summary = parts.length ? `Got it - you're looking for ${parts.join(" ")}.` : "Got it.";
  if (requirements.site_visit_interest) {
    return `${summary} I'll check matching options now. Do you prefer approved layouts, gated community plots, or open plots?`;
  }
  return `${summary} Which location or budget range should I prioritize?`;
}

function normalizeAction(value: string) {
  return value.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function formatIndianNumber(value: number) {
  if (value >= 10_000_000) return `${value / 10_000_000} cr`;
  if (value >= 100_000) return `${value / 100_000} lakh`;
  return String(value);
}
