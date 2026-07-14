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
  customer_role?: string | null;
  listing_intent?: "buy" | "rent" | "sell" | "lease" | "unknown" | null;
  property_category?: "residential" | "commercial" | "land" | "unknown" | null;
  preferred_locations?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
  currency?: string | null;
  property_type?: string | null;
  property_stage?: string | null;
  bedroom_count?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_min?: number | null;
  area_max?: number | null;
  area_unit?: string | null;
  plot_facing?: string | null;
  road_width?: string | null;
  approval_authority?: string | null;
  rera_id?: string | null;
  possession_timeline?: string | null;
  buying_timeline?: string | null;
  listing_type?: "sale" | "rent" | null;
  timeline?: string | null;
  financing_interest?: boolean | null;
  financing_required?: boolean | null;
  loan_preapproved?: boolean | null;
  furnishing?: string | null;
  parking_required?: boolean | null;
  amenities?: string[];
  site_visit_interest?: boolean | null;
  preferred_appointment_date?: string | null;
  preferred_appointment_time?: string | null;
  preferred_appointment_at?: string | null;
  property_reference?: string | null;
  seller_property_details?: Record<string, unknown> | null;
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
