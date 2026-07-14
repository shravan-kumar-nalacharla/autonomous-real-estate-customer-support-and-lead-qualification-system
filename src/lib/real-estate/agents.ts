import { supabaseAdmin } from "@/lib/flows/admin-client";
import { dispatchN8nEvent } from "@/lib/n8n-dispatcher";
import { scoreLead } from "./lead-scoring";
import { findPropertyMatches } from "./property-matching";
import type {
  AgentActivityInput,
  AgentInput,
  ParsedLeadRequirements,
  RealEstateIntent,
} from "./types";

export async function runRealEstateAgents(input: AgentInput): Promise<void> {
  const db = supabaseAdmin();
  const idempotencyBase = `meta:${input.metaMessageId}`;

  const { data: existingActivity } = await db
    .from("agent_activity_logs")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("idempotency_key", `${idempotencyBase}:orchestrator`)
    .maybeSingle();
  if (existingActivity) return;

  const { data: conversation } = await db
    .from("conversations")
    .select("automation_mode, assigned_agent_id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (
    conversation?.automation_mode === "human" ||
    conversation?.assigned_agent_id
  ) {
    await logActivity({
      ...baseActivity(input, "orchestrator", `${idempotencyBase}:orchestrator`),
      actionType: "skipped_human_owned_conversation",
      inputSummary: summarize(input.text),
      outputSummary: "Automated real-estate agents skipped.",
      reason: "Conversation is already assigned to a human or automation is paused.",
      confidence: 1,
    });
    return;
  }

  const intent = classifyIntent(input.text);
  await logActivity({
    ...baseActivity(input, "orchestrator", `${idempotencyBase}:orchestrator`),
    actionType: "intent_routed",
    inputSummary: summarize(input.text),
    outputSummary: `Intent: ${intent}`,
    reason: "Keyword and phrase based deterministic routing.",
    confidence: intent === "unknown" ? 0.35 : 0.8,
  });

  await dispatchN8nEvent({
    organizationId: input.organizationId,
    event: "message.received",
    entityType: "message",
    entityId: input.messageId,
    idempotencyKey: `${idempotencyBase}:message.received`,
    payload: {
      contactId: input.contactId,
      conversationId: input.conversationId,
      customerPhone: input.customerPhone,
      customerName: input.customerName,
      intent,
      messageSummary: summarize(input.text),
    },
  });

  const parsed = parseRequirements(input.text, intent);
  const hasRequirementUpdate = hasRequirementSignal(parsed);
  if (hasRequirementUpdate) {
    await updateLeadQualification(input, parsed, idempotencyBase);
  }

  if (
    intent === "property_search" ||
    intent === "rental_enquiry" ||
    intent === "commercial_enquiry" ||
    intent === "seller_lead" ||
    hasRequirementUpdate
  ) {
    await recommendProperties(input, idempotencyBase);
  }

  if (intent === "appointment_request" || intent === "menu_book_site_visit") {
    await createAppointmentRequest(input, idempotencyBase);
  } else if (intent === "appointment_change") {
    await createFollowUpTask(
      input,
      "appointment_change_requested",
      `${idempotencyBase}:appointment_change_followup`,
    );
  }

  if (
    intent === "human_support" ||
    intent === "menu_talk_to_agent" ||
    intent === "complaint_or_sensitive" ||
    intent === "unknown"
  ) {
    await createHumanHandoff(input, intent, idempotencyBase);
  }

  if (intent === "general_enquiry" && !hasRequirementUpdate) {
    await createFollowUpTask(
      input,
      "incomplete_qualification",
      `${idempotencyBase}:incomplete_qualification_followup`,
    );
  }
}

async function updateLeadQualification(
  input: AgentInput,
  parsed: ParsedLeadRequirements,
  idempotencyBase: string,
) {
  const db = supabaseAdmin();
  const { data: current } = await db
    .from("lead_requirements")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .maybeSingle();

  const merged = mergeRequirements(current as ParsedLeadRequirements | null, parsed);

  const { data: requirement, error } = await db
    .from("lead_requirements")
    .upsert(
      {
        organization_id: input.organizationId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        ...merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,contact_id" },
    )
    .select("*")
    .single();

  if (error || !requirement) {
    console.error("[qualification] requirement upsert failed:", error?.message);
    return;
  }

  const previousCategory = await getLeadCategory(input.organizationId, input.contactId);
  const score = scoreLead({
    ...merged,
    hasVerifiedContact: Boolean(input.customerPhone),
  });

  const { data: scoreRow } = await db
    .from("lead_scores")
    .upsert(
      {
        organization_id: input.organizationId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        requirement_id: requirement.id,
        score: score.score,
        category: score.category,
        breakdown: score.breakdown,
        explanation: score.explanation,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,contact_id" },
    )
    .select("*")
    .single();

  await logActivity({
    ...baseActivity(input, "qualification", `${idempotencyBase}:qualification`),
    actionType: "lead_requirements_updated",
    inputSummary: summarize(input.text),
    outputSummary: `Lead scored ${score.score}/100 as ${score.category}.`,
    reason: score.explanation,
    confidence: 0.82,
    relatedEntityIds: {
      requirementId: requirement.id,
      scoreId: scoreRow?.id,
    },
  });

  await dispatchN8nEvent({
    organizationId: input.organizationId,
    event: "lead.requirements_updated",
    entityType: "lead_requirements",
    entityId: requirement.id,
    idempotencyKey: `${idempotencyBase}:lead.requirements_updated`,
    payload: {
      contactId: input.contactId,
      conversationId: input.conversationId,
      score: score.score,
      category: score.category,
      explanation: score.explanation,
    },
  });

  if (previousCategory && previousCategory !== score.category) {
    await dispatchN8nEvent({
      organizationId: input.organizationId,
      event: "lead.category_changed",
      entityType: "lead_scores",
      entityId: scoreRow?.id ?? input.contactId,
      idempotencyKey: `${idempotencyBase}:lead.category_changed:${score.category}`,
      payload: {
        contactId: input.contactId,
        previousCategory,
        category: score.category,
        score: score.score,
      },
    });
  }

  if (score.category === "hot") {
    await dispatchN8nEvent({
      organizationId: input.organizationId,
      event: "lead.hot",
      entityType: "lead_scores",
      entityId: scoreRow?.id ?? input.contactId,
      idempotencyKey: `${idempotencyBase}:lead.hot`,
      payload: {
        contactId: input.contactId,
        conversationId: input.conversationId,
        score: score.score,
        explanation: score.explanation,
      },
    });
    await createHumanHandoff(input, "hot_lead", idempotencyBase);
  }
}

async function recommendProperties(input: AgentInput, idempotencyBase: string) {
  const db = supabaseAdmin();
  const { data: requirements } = await db
    .from("lead_requirements")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .maybeSingle();
  if (!requirements) return;

  const matches = await findPropertyMatches({
    db,
    organizationId: input.organizationId,
    requirements: requirements as ParsedLeadRequirements,
  });
  if (matches.length === 0) return;

  for (const match of matches) {
    const { data } = await db
      .from("property_recommendations")
      .upsert(
        {
          organization_id: input.organizationId,
          contact_id: input.contactId,
          conversation_id: input.conversationId,
          property_id: match.property_id,
          match_score: match.match_score,
          matching_reasons: match.matching_reasons,
        },
        { onConflict: "organization_id,contact_id,property_id" },
      )
      .select("id")
      .maybeSingle();

    await dispatchN8nEvent({
      organizationId: input.organizationId,
      event: "property.recommendation_created",
      entityType: "property_recommendations",
      entityId: data?.id ?? match.property_id,
      idempotencyKey: `${idempotencyBase}:property.recommendation:${match.property_id}`,
      payload: {
        contactId: input.contactId,
        conversationId: input.conversationId,
        propertyId: match.property_id,
        matchScore: match.match_score,
        reasons: match.matching_reasons,
      },
    });
  }

  await logActivity({
    ...baseActivity(input, "property_matching", `${idempotencyBase}:property_matching`),
    actionType: "properties_recommended",
    inputSummary: summarize(input.text),
    outputSummary: `${matches.length} available properties matched.`,
    reason: matches.flatMap((match) => match.matching_reasons).join("; "),
    confidence: 0.75,
  });
}

async function createAppointmentRequest(input: AgentInput, idempotencyBase: string) {
  const db = supabaseAdmin();
  const { data: latestRecommendation } = await db
    .from("property_recommendations")
    .select("property_id")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: appointment, error } = await db
    .from("appointments")
    .insert({
      organization_id: input.organizationId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      property_id: latestRecommendation?.property_id ?? null,
      status: "requested",
      notes: "Customer requested a site visit on WhatsApp. Human confirmation required.",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    await logActivity({
      ...baseActivity(input, "appointment", `${idempotencyBase}:appointment_duplicate`),
      actionType: "appointment_request_not_created",
      inputSummary: summarize(input.text),
      outputSummary: "Existing active appointment likely already exists.",
      reason: error.message,
      confidence: 0.7,
    });
    return;
  }

  await createFollowUpTask(
    input,
    "appointment_confirmation_required",
    `${idempotencyBase}:appointment_confirmation_task`,
  );

  await logActivity({
    ...baseActivity(input, "appointment", `${idempotencyBase}:appointment`),
    actionType: "appointment_requested",
    inputSummary: summarize(input.text),
    outputSummary: "Created a requested appointment pending human confirmation.",
    reason: "Customer asked for visit, schedule, appointment, or site visit.",
    confidence: 0.84,
    relatedEntityIds: { appointmentId: appointment?.id },
  });

  await dispatchN8nEvent({
    organizationId: input.organizationId,
    event: "appointment.requested",
    entityType: "appointments",
    entityId: appointment?.id ?? input.contactId,
    idempotencyKey: `${idempotencyBase}:appointment.requested`,
    payload: {
      contactId: input.contactId,
      conversationId: input.conversationId,
      appointmentId: appointment?.id,
    },
  });
}

async function createFollowUpTask(
  input: AgentInput,
  reason: string,
  idempotencyKey: string,
) {
  const db = supabaseAdmin();
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from("follow_up_tasks")
    .upsert(
      {
        organization_id: input.organizationId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        reason,
        due_at: dueAt,
        status: "pending",
      },
      { onConflict: "organization_id,contact_id,reason", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  await logActivity({
    ...baseActivity(input, "followup", idempotencyKey),
    actionType: "followup_task_created",
    inputSummary: summarize(input.text),
    outputSummary: `Follow-up task: ${reason}.`,
    reason: "Deterministic follow-up rule.",
    confidence: 0.72,
    relatedEntityIds: { followUpTaskId: data?.id },
  });

  await dispatchN8nEvent({
    organizationId: input.organizationId,
    event: "followup.created",
    entityType: "follow_up_tasks",
    entityId: data?.id ?? input.contactId,
    idempotencyKey: `${idempotencyKey}:event`,
    payload: {
      contactId: input.contactId,
      conversationId: input.conversationId,
      reason,
      dueAt,
    },
  });
}

async function createHumanHandoff(
  input: AgentInput,
  reason: string,
  idempotencyBase: string,
) {
  const db = supabaseAdmin();
  const assignedAgentId = await leastLoadedAgent(input.organizationId);
  const { data: handoff } = await db
    .from("human_handoffs")
    .insert({
      organization_id: input.organizationId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      assigned_agent_id: assignedAgentId,
      reason,
      status: "open",
    })
    .select("id")
    .maybeSingle();

  await db
    .from("conversations")
    .update({
      automation_mode: "human",
      status: "pending",
      assigned_agent_id: assignedAgentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId);

  await logActivity({
    ...baseActivity(input, "escalation", `${idempotencyBase}:handoff:${reason}`),
    actionType: "human_handoff_created",
    inputSummary: summarize(input.text),
    outputSummary: assignedAgentId
      ? "Conversation handed off to a sales agent."
      : "Conversation handed off for manual assignment.",
    reason,
    confidence: 0.86,
    relatedEntityIds: { handoffId: handoff?.id, assignedAgentId },
  });

  await dispatchN8nEvent({
    organizationId: input.organizationId,
    event: "human_escalation.created",
    entityType: "human_handoffs",
    entityId: handoff?.id ?? input.conversationId,
    idempotencyKey: `${idempotencyBase}:human_escalation.created:${reason}`,
    payload: {
      contactId: input.contactId,
      conversationId: input.conversationId,
      reason,
      assignedAgentId,
    },
  });
}

async function leastLoadedAgent(organizationId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: members } = await db
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", ["agent", "manager", "admin", "owner"]);
  if (!members?.length) return null;

  const candidates = (members as Array<{ user_id: string; role: string }>).map(
    (member) => member.user_id,
  );
  const { data: conversations } = await db
    .from("conversations")
    .select("assigned_agent_id")
    .eq("organization_id", organizationId)
    .in("assigned_agent_id", candidates);
  const load = new Map(candidates.map((id) => [id, 0]));
  for (const row of (conversations ?? []) as Array<{ assigned_agent_id: string | null }>) {
    if (row.assigned_agent_id) {
      load.set(row.assigned_agent_id, (load.get(row.assigned_agent_id) ?? 0) + 1);
    }
  }
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
}

async function getLeadCategory(organizationId: string, contactId: string) {
  const { data } = await supabaseAdmin()
    .from("lead_scores")
    .select("category")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .maybeSingle();
  return (data as { category?: string } | null)?.category ?? null;
}

async function logActivity(input: AgentActivityInput) {
  const { error } = await supabaseAdmin().from("agent_activity_logs").upsert(
    {
      organization_id: input.organizationId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      agent_type: input.agentType,
      action_type: input.actionType,
      input_summary: input.inputSummary,
      output_summary: input.outputSummary,
      reason: input.reason,
      confidence: input.confidence,
      related_entity_ids: input.relatedEntityIds ?? {},
      idempotency_key: input.idempotencyKey,
    },
    { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true },
  );
  if (error) console.error("[agent_activity] log failed:", error.message);
}

function baseActivity(
  input: AgentInput,
  agentType: AgentActivityInput["agentType"],
  idempotencyKey: string,
) {
  return {
    organizationId: input.organizationId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    agentType,
    idempotencyKey,
  };
}

export function classifyIntent(text: string): RealEstateIntent {
  const lower = normalizeActionText(text);
  if (/^(hi|hello|hey|good morning|good evening|good afternoon|namaste)$/.test(lower)) {
    return "greeting";
  }
  if (/^(find property|find_property|property search|1)$/.test(lower)) {
    return "menu_find_property";
  }
  if (/^(book site visit|book_site_visit|site visit|2)$/.test(lower)) {
    return "menu_book_site_visit";
  }
  if (/^(talk to agent|talk_to_agent|agent|human|3)$/.test(lower)) {
    return "menu_talk_to_agent";
  }
  if (/\b(stop|unsubscribe|opt out)\b/.test(lower)) return "human_support";
  if (/\b(complaint|angry|fraud|legal|lawyer|loan approval|negotiate|urgent)\b/.test(lower)) {
    return "complaint_or_sensitive";
  }
  if (/\b(sell|seller|owner|landlord)\b/.test(lower)) return "seller_lead";
  if (/\b(human|agent|salesperson|call me|talk to)\b/.test(lower)) {
    return "human_support";
  }
  if (/\b(reschedule|cancel|change.*visit|change.*appointment)\b/.test(lower)) {
    return "appointment_change";
  }
  if (/\b(visit|site visit|appointment|schedule|book|meet)\b/.test(lower)) {
    return "appointment_request";
  }
  if (/\b(rent|rental|tenant|lease)\b/.test(lower)) return "rental_enquiry";
  if (/\b(commercial|shop|office|warehouse|showroom)\b/.test(lower)) {
    return "commercial_enquiry";
  }
  if (/\b(budget|bhk|bedroom|flat|villa|plot|rent|buy|purchase|location|near|looking for)\b/.test(lower)) {
    return "property_search";
  }
  if (/\b(price|area|amenities|available|availability)\b/.test(lower)) {
    return "property_question";
  }
  if (lower.trim().length < 8) return "unknown";
  return "general_enquiry";
}

export function parseRequirements(
  text: string,
  intent: RealEstateIntent,
): ParsedLeadRequirements {
  const lower = text.toLowerCase();
  const bedrooms = lower.match(/\b([1-6])\s*(bhk|bed(room)?s?)\b/);
  const budget = parseBudget(lower);
  const locations = parseLocations(text);
  const propertyType = parsePropertyType(lower);
  const area = parseArea(lower);
  const listingType = /\b(rent|rental|lease)\b/.test(lower)
    ? "rent"
    : /\b(buy|purchase|sale)\b/.test(lower)
      ? "sale"
      : null;
  const timeline = parseTimeline(lower);

  return {
    customer_role: parseCustomerRole(lower, intent),
    listing_intent: parseListingIntent(lower, intent),
    property_category: parsePropertyCategory(lower),
    preferred_locations: locations.length ? locations : undefined,
    budget_min: budget.min,
    budget_max: budget.max,
    currency: budget.min || budget.max ? "INR" : undefined,
    property_type: propertyType,
    property_stage: propertyType === "plot" ? "land_plot" : undefined,
    bedroom_count: bedrooms ? Number(bedrooms[1]) : null,
    bedrooms: bedrooms ? Number(bedrooms[1]) : null,
    area_min: area.value,
    area_max: area.value,
    area_unit: area.unit,
    plot_facing: parseFacing(lower),
    listing_type: listingType,
    timeline,
    financing_interest: /\b(loan|finance|emi|mortgage)\b/.test(lower) || null,
    financing_required: /\b(loan|finance|emi|mortgage)\b/.test(lower) || null,
    site_visit_interest:
      intent === "appointment_request" || /\b(site visit|visit|schedule)\b/.test(lower),
    preferred_appointment_time: parseAppointmentTime(lower),
  };
}

function normalizeActionText(text: string) {
  return text.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseCustomerRole(lower: string, intent: RealEstateIntent) {
  if (intent === "seller_lead" || /\b(sell|seller|owner)\b/.test(lower)) return "seller";
  if (/\b(landlord)\b/.test(lower)) return "landlord";
  if (/\b(investor|investment)\b/.test(lower)) return "investor";
  if (/\b(broker|agent)\b/.test(lower)) return "broker";
  if (/\b(rent|rental|tenant|lease)\b/.test(lower)) return "renter";
  if (/\b(buy|purchase|looking for|plot|flat|villa|bhk)\b/.test(lower)) return "buyer";
  return "unknown";
}

function parseListingIntent(lower: string, intent: RealEstateIntent) {
  if (intent === "seller_lead" || /\b(sell|seller)\b/.test(lower)) return "sell";
  if (/\b(rent|rental)\b/.test(lower)) return "rent";
  if (/\blease\b/.test(lower)) return "lease";
  if (/\b(buy|purchase|looking for|plot|flat|villa|bhk)\b/.test(lower)) return "buy";
  return "unknown";
}

function parsePropertyCategory(lower: string) {
  if (/\b(plot|land|acre|gunta|sq yd|sqyd|yard)\b/.test(lower)) return "land";
  if (/\b(commercial|shop|office|warehouse|showroom)\b/.test(lower)) return "commercial";
  if (/\b(flat|apartment|villa|house|bhk|residential)\b/.test(lower)) return "residential";
  return "unknown";
}

function parseArea(lower: string): { value: number | null; unit: string | null } {
  const match = lower.match(/\b(\d+(?:\.\d+)?)\s*(sq\.?\s*ft|sqft|square feet|sq\.?\s*yd|sqyd|sq yd|yard|yards|acre|acres|cent|cents|gunta|guntas)\b/);
  if (!match) return { value: null, unit: null };
  const rawUnit = match[2].replace(/\s+/g, "");
  const unit = rawUnit.includes("yd") || rawUnit.includes("yard")
    ? "sqyd"
    : rawUnit.includes("ft") || rawUnit.includes("feet")
      ? "sqft"
      : rawUnit.includes("acre")
        ? "acre"
        : rawUnit.includes("cent")
          ? "cent"
          : "gunta";
  return { value: Number(match[1]), unit };
}

function parseFacing(lower: string): string | null {
  const match = lower.match(/\b(east|west|north|south|north east|north west|south east|south west)[ -]?facing\b/);
  return match?.[1]?.replace(/\s+/g, "_") ?? null;
}

function parseAppointmentTime(lower: string): string | null {
  const match = lower.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b(?:\s+(morning|afternoon|evening|night))?/);
  if (!match) return null;
  return [match[1], match[2]].filter(Boolean).join(" ");
}

function mergeRequirements(
  current: ParsedLeadRequirements | null,
  next: ParsedLeadRequirements,
): ParsedLeadRequirements {
  return {
    customer_role: next.customer_role ?? current?.customer_role ?? null,
    listing_intent: next.listing_intent ?? current?.listing_intent ?? null,
    property_category: next.property_category ?? current?.property_category ?? null,
    preferred_locations:
      next.preferred_locations?.length
        ? unique([...(current?.preferred_locations ?? []), ...next.preferred_locations])
        : current?.preferred_locations ?? [],
    budget_min: next.budget_min ?? current?.budget_min ?? null,
    budget_max: next.budget_max ?? current?.budget_max ?? null,
    currency: next.currency ?? current?.currency ?? null,
    property_type: next.property_type ?? current?.property_type ?? null,
    property_stage: next.property_stage ?? current?.property_stage ?? null,
    bedroom_count: next.bedroom_count ?? current?.bedroom_count ?? null,
    bedrooms: next.bedrooms ?? current?.bedrooms ?? null,
    area_min: next.area_min ?? current?.area_min ?? null,
    area_max: next.area_max ?? current?.area_max ?? null,
    area_unit: next.area_unit ?? current?.area_unit ?? null,
    plot_facing: next.plot_facing ?? current?.plot_facing ?? null,
    listing_type: next.listing_type ?? current?.listing_type ?? null,
    timeline: next.timeline ?? current?.timeline ?? null,
    financing_required:
      next.financing_required ?? current?.financing_required ?? null,
    financing_interest:
      next.financing_interest ?? current?.financing_interest ?? null,
    site_visit_interest:
      next.site_visit_interest ?? current?.site_visit_interest ?? false,
    preferred_appointment_date:
      next.preferred_appointment_date ?? current?.preferred_appointment_date ?? null,
    preferred_appointment_time:
      next.preferred_appointment_time ?? current?.preferred_appointment_time ?? null,
    preferred_appointment_at:
      next.preferred_appointment_at ?? current?.preferred_appointment_at ?? null,
    property_reference:
      next.property_reference ?? current?.property_reference ?? null,
  };
}

function hasRequirementSignal(parsed: ParsedLeadRequirements): boolean {
  return Boolean(
    (parsed.customer_role && parsed.customer_role !== "unknown") ||
      (parsed.listing_intent && parsed.listing_intent !== "unknown") ||
      (parsed.property_category && parsed.property_category !== "unknown") ||
      parsed.preferred_locations?.length ||
      parsed.budget_min != null ||
      parsed.budget_max != null ||
      parsed.property_type ||
      parsed.area_min != null ||
      parsed.area_max != null ||
      parsed.plot_facing ||
      parsed.bedroom_count ||
      parsed.listing_type ||
      parsed.timeline ||
      parsed.financing_interest ||
      parsed.site_visit_interest,
  );
}

function parseBudget(text: string): { min: number | null; max: number | null } {
  const range = text.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|cr|crore|k)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(lakh|lac|cr|crore|k)?/);
  if (range) {
    return {
      min: moneyToNumber(range[1], range[2]),
      max: moneyToNumber(range[3], range[4] || range[2]),
    };
  }
  const single = text.match(/(?:budget|under|below|upto|up to|around)\s*(\d+(?:\.\d+)?)\s*(lakh|lac|cr|crore|k)?/);
  if (single) return { min: null, max: moneyToNumber(single[1], single[2]) };
  return { min: null, max: null };
}

function moneyToNumber(value: string, unit?: string): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  if (unit === "cr" || unit === "crore") return raw * 10_000_000;
  if (unit === "lakh" || unit === "lac") return raw * 100_000;
  if (unit === "k") return raw * 1_000;
  return raw;
}

function parseLocations(text: string): string[] {
  const match = text.match(/\b(?:in|near|around)\s+([A-Za-z][A-Za-z\s-]{2,40})/);
  if (!match) return [];
  return [
    match[1]
      .replace(/\b(under|below|budget|with|this month|this week|within|for)\b.*$/i, "")
      .replace(/[?.!,].*$/, "")
      .trim(),
  ].filter(Boolean);
}

function parsePropertyType(text: string): string | null {
  if (/\bvilla\b/.test(text)) return "villa";
  if (/\bplot\b/.test(text)) return "plot";
  if (/\b(apartment|flat)\b/.test(text)) return "apartment";
  if (/\boffice|commercial\b/.test(text)) return "commercial";
  return null;
}

function parseTimeline(text: string): string | null {
  if (/\b(immediate|asap|urgent|this week)\b/.test(text)) return "immediate";
  if (/\b(this month|30 days|1 month)\b/.test(text)) return "within_1_month";
  if (/\b(3 months|quarter)\b/.test(text)) return "within_3_months";
  if (/\b(6 months|later)\b/.test(text)) return "within_6_months";
  return null;
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 180 ? clean : `${clean.slice(0, 177)}...`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
