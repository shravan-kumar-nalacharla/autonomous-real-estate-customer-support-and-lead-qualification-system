export type LeadCategory = "hot" | "warm" | "cold" | "general_enquiry";

export type RealEstateIntent =
  | "property_search"
  | "requirements_update"
  | "property_question"
  | "appointment_request"
  | "appointment_change"
  | "followup_response"
  | "human_support"
  | "complaint_or_sensitive"
  | "general_enquiry"
  | "unknown";

export interface ParsedLeadRequirements {
  preferred_locations?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
  property_type?: string | null;
  bedroom_count?: number | null;
  listing_type?: "sale" | "rent" | null;
  timeline?: string | null;
  financing_interest?: boolean | null;
  site_visit_interest?: boolean | null;
}

export interface LeadScoreResult {
  score: number;
  category: LeadCategory;
  breakdown: Record<string, number>;
  explanation: string;
}

export interface AgentInput {
  organizationId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  metaMessageId: string;
  text: string;
  customerPhone: string;
  customerName: string;
}

export interface AgentActivityInput {
  organizationId: string;
  contactId: string;
  conversationId: string;
  agentType:
    | "orchestrator"
    | "qualification"
    | "property_matching"
    | "appointment"
    | "followup"
    | "escalation"
    | "n8n_dispatch";
  actionType: string;
  inputSummary?: string;
  outputSummary?: string;
  reason?: string;
  confidence?: number;
  relatedEntityIds?: Record<string, string | null | undefined>;
  idempotencyKey: string;
}
