import { NextResponse } from "next/server";
import { isInternalRequestAuthorized, isUuid } from "@/lib/internal-secret";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  getEventDuplicateState,
  resolveRealEstateContext,
} from "@/lib/real-estate/n8n-context";
import type { ParsedLeadRequirements } from "@/lib/real-estate/types";

type JsonRecord = Record<string, unknown>;

interface AgentPlanBody {
  idempotency_key?: string;
  event_id?: string;
  organization_id?: string;
  conversation_id?: string;
  contact_id?: string;
  requirements?: ParsedLeadRequirements;
  lead_score?: {
    score?: number;
    category?: string;
    breakdown?: JsonRecord;
    explanation?: string;
  };
  property_recommendations?: Array<{
    property_id?: string;
    match_score?: number;
    matching_reasons?: string[];
  }>;
  appointment_request?: {
    property_id?: string | null;
    assigned_agent_id?: string | null;
    requested_start_at?: string | null;
    proposed_start_at?: string | null;
    notes?: string | null;
  };
  follow_up_task?: {
    reason?: string;
    due_at?: string;
    assigned_agent_id?: string | null;
  };
  human_handoff?: {
    required?: boolean;
    reason?: string;
    assigned_agent_id?: string | null;
  };
  activity_logs?: Array<{
    agent_type?: string;
    action_type?: string;
    input_summary?: string;
    output_summary?: string;
    reason?: string;
    confidence?: number;
    related_entity_ids?: JsonRecord;
    idempotency_key?: string;
  }>;
  pipeline_update?: { requested_stage?: string };
  conversation_update?: {
    automation_mode?: string;
    clear_handoff_active?: boolean;
  };
  allow_agent_mode_send?: boolean;
}

const PIPELINE_STAGES = new Set([
  "new_enquiry",
  "requirements_captured",
  "qualified_warm",
  "qualified_hot",
  "property_matched",
  "site_visit_requested",
  "site_visit_proposed",
  "site_visit_confirmed",
  "negotiation",
  "won",
  "lost",
  "human_handoff",
  "opted_out",
]);

export async function POST(request: Request) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as AgentPlanBody | null;
  if (!body?.idempotency_key) {
    return NextResponse.json({ error: "idempotency_key is required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const resolved = await resolveRealEstateContext(db, body);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  if (!resolved.contact?.id || !resolved.conversation?.id) {
    return NextResponse.json(
      { error: "conversation_id and contact_id are required or resolvable" },
      { status: 400 },
    );
  }

  const organizationId = resolved.organizationId;
  const contactId = String(resolved.contact.id);
  const conversationId = String(resolved.conversation.id);
  const duplicateState = await getEventDuplicateState(db, {
    organizationId,
    eventId: body.event_id,
  });
  if (duplicateState.event_already_completed) {
    return NextResponse.json({
      success: true,
      organization_id: organizationId,
      send_allowed: false,
      duplicate: true,
      pipeline_stage: resolved.conversation.pipeline_stage ?? null,
    });
  }

  let leadRequirementId: string | null = null;
  let leadScoreId: string | null = null;
  let appointmentId: string | null = null;
  let handoffId: string | null = null;
  let pipelineStage =
    normalizePipelineStage(body.pipeline_update?.requested_stage) ??
    inferPipelineStage(body);

  if (
    body.allow_agent_mode_send === true &&
    body.conversation_update?.clear_handoff_active === true &&
    body.conversation_update.automation_mode === "agent" &&
    resolved.conversation.automation_mode === "agent"
  ) {
    await clearStaleAgentModeHandoff({
      organizationId,
      conversationId,
    });
  }

  if (body.requirements) {
    const { data, error } = await db
      .from("lead_requirements")
      .upsert(
        {
          organization_id: organizationId,
          contact_id: contactId,
          conversation_id: conversationId,
          ...toLeadRequirementRow(body.requirements),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,contact_id" },
      )
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    leadRequirementId = data.id;
  }

  if (body.lead_score) {
    const score = clampNumber(body.lead_score.score, 0, 100, 0);
    const { data, error } = await db
      .from("lead_scores")
      .upsert(
        {
          organization_id: organizationId,
          contact_id: contactId,
          conversation_id: conversationId,
          requirement_id: leadRequirementId,
          score,
          category: normalizeLeadCategory(body.lead_score.category, score),
          breakdown: body.lead_score.breakdown ?? {},
          explanation: body.lead_score.explanation ?? "Scored by n8n lead plan.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,contact_id" },
      )
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    leadScoreId = data.id;
  }

  for (const recommendation of body.property_recommendations ?? []) {
    if (!isUuid(recommendation.property_id)) continue;
    const propertyOk = await propertyBelongsToOrg(
      recommendation.property_id,
      organizationId,
    );
    if (!propertyOk) continue;
    await db.from("property_recommendations").upsert(
      {
        organization_id: organizationId,
        contact_id: contactId,
        conversation_id: conversationId,
        property_id: recommendation.property_id,
        match_score: clampNumber(recommendation.match_score, 0, 100, 0),
        matching_reasons: recommendation.matching_reasons ?? [],
      },
      { onConflict: "organization_id,contact_id,property_id" },
    );
    pipelineStage = pipelineStage ?? "property_matched";
  }

  if (body.appointment_request) {
    const propertyId = isUuid(body.appointment_request.property_id)
      ? body.appointment_request.property_id
      : null;
    const { data, error } = await db
      .from("appointments")
      .upsert(
        {
          organization_id: organizationId,
          contact_id: contactId,
          conversation_id: conversationId,
          property_id: propertyId,
          assigned_agent_id: isUuid(body.appointment_request.assigned_agent_id)
            ? body.appointment_request.assigned_agent_id
            : null,
          requested_start_at: body.appointment_request.requested_start_at ?? null,
          proposed_start_at: body.appointment_request.proposed_start_at ?? null,
          status: body.appointment_request.proposed_start_at ? "proposed" : "requested",
          notes:
            body.appointment_request.notes ??
            "Customer requested a site visit through WhatsApp automation.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,contact_id,property_id" },
      )
      .select("id, status")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    appointmentId = data?.id ?? null;
    pipelineStage =
      data?.status === "proposed" ? "site_visit_proposed" : "site_visit_requested";
  }

  if (body.follow_up_task?.reason) {
    await db.from("follow_up_tasks").upsert(
      {
        organization_id: organizationId,
        contact_id: contactId,
        conversation_id: conversationId,
        assigned_agent_id: isUuid(body.follow_up_task.assigned_agent_id)
          ? body.follow_up_task.assigned_agent_id
          : null,
        reason: body.follow_up_task.reason,
        due_at:
          body.follow_up_task.due_at ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: "pending",
        source: "n8n_agent_plan",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,contact_id,reason" },
    );
  }

  if (body.human_handoff?.required) {
    const { data, error } = await db
      .from("human_handoffs")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        conversation_id: conversationId,
        assigned_agent_id: isUuid(body.human_handoff.assigned_agent_id)
          ? body.human_handoff.assigned_agent_id
          : null,
        reason: body.human_handoff.reason ?? "n8n_agent_plan_requested_handoff",
        status: "open",
      })
      .select("id")
      .maybeSingle();
    if (!error) handoffId = data?.id ?? null;
    pipelineStage = "human_handoff";
    await db
      .from("conversations")
      .update({
        automation_mode: "human",
        automation_paused: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
  }

  for (const [index, log] of (body.activity_logs ?? []).entries()) {
    await db.from("agent_activity_logs").upsert(
      {
        organization_id: organizationId,
        contact_id: contactId,
        conversation_id: conversationId,
        agent_type: normalizeAgentType(log.agent_type),
        action_type: log.action_type || "n8n_agent_plan_applied",
        input_summary: log.input_summary,
        output_summary: log.output_summary,
        reason: log.reason,
        confidence: log.confidence,
        related_entity_ids: log.related_entity_ids ?? {},
        idempotency_key:
          log.idempotency_key ?? `${body.idempotency_key}:activity:${index}`,
      },
      { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true },
    );
  }

  if (pipelineStage) {
    await db
      .from("conversations")
      .update({
        pipeline_stage: pipelineStage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
  }

  await db.from("n8n_event_statuses").upsert(
    {
      organization_id: organizationId,
      event_id: body.event_id ?? body.idempotency_key,
      idempotency_key: body.idempotency_key,
      status: "processing",
      outcome: { agent_plan_applied: true },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,event_id" },
  );

  const sendAllowed = await computeSendAllowed(db, {
    organizationId,
    conversationId,
    contactId,
    duplicate: duplicateState.event_is_duplicate,
  });

  return NextResponse.json({
    success: true,
    organization_id: organizationId,
    send_allowed: sendAllowed,
    lead_requirement_id: leadRequirementId,
    lead_score_id: leadScoreId,
    appointment_id: appointmentId,
    handoff_id: handoffId,
    pipeline_stage: pipelineStage,
  });
}

function toLeadRequirementRow(requirements: ParsedLeadRequirements) {
  return {
    customer_role: requirements.customer_role ?? "unknown",
    listing_intent: requirements.listing_intent ?? "unknown",
    property_category: requirements.property_category ?? "unknown",
    property_type: requirements.property_type ?? "unknown",
    property_stage: requirements.property_stage ?? "unknown",
    preferred_locations: requirements.preferred_locations ?? [],
    budget_min: requirements.budget_min ?? null,
    budget_max: requirements.budget_max ?? null,
    currency: requirements.currency ?? "INR",
    bedrooms: requirements.bedrooms ?? requirements.bedroom_count ?? null,
    bedroom_count: requirements.bedroom_count ?? requirements.bedrooms ?? null,
    bathrooms: requirements.bathrooms ?? null,
    area_min: requirements.area_min ?? null,
    area_max: requirements.area_max ?? null,
    area_unit: requirements.area_unit ?? null,
    plot_facing: requirements.plot_facing ?? null,
    road_width: requirements.road_width ?? null,
    approval_authority: requirements.approval_authority ?? null,
    rera_id: requirements.rera_id ?? null,
    possession_timeline: requirements.possession_timeline ?? null,
    buying_timeline: requirements.buying_timeline ?? requirements.timeline ?? null,
    timeline: requirements.timeline ?? null,
    financing_required:
      requirements.financing_required ?? requirements.financing_interest ?? null,
    financing_interest:
      requirements.financing_interest ?? requirements.financing_required ?? null,
    loan_preapproved: requirements.loan_preapproved ?? null,
    furnishing: requirements.furnishing ?? null,
    parking_required: requirements.parking_required ?? null,
    amenities: requirements.amenities ?? [],
    site_visit_interest: requirements.site_visit_interest ?? false,
    preferred_appointment_date: requirements.preferred_appointment_date ?? null,
    preferred_appointment_time: requirements.preferred_appointment_time ?? null,
    preferred_appointment_at: requirements.preferred_appointment_at ?? null,
    property_reference: requirements.property_reference ?? null,
    seller_property_details: requirements.seller_property_details ?? {},
    listing_type:
      requirements.listing_type ??
      (requirements.listing_intent === "rent" || requirements.listing_intent === "lease"
        ? "rent"
        : requirements.listing_intent === "buy" || requirements.listing_intent === "sell"
          ? "sale"
          : null),
  };
}

function normalizePipelineStage(stage?: string | null) {
  if (!stage) return null;
  return PIPELINE_STAGES.has(stage) ? stage : null;
}

function inferPipelineStage(body: AgentPlanBody) {
  if (body.human_handoff?.required) return "human_handoff";
  if (body.appointment_request?.proposed_start_at) return "site_visit_proposed";
  if (body.appointment_request) return "site_visit_requested";
  if (body.property_recommendations?.length) return "property_matched";
  if (body.lead_score?.category === "hot") return "qualified_hot";
  if (body.lead_score?.category === "warm") return "qualified_warm";
  if (body.requirements) return "requirements_captured";
  return null;
}

function normalizeLeadCategory(category: unknown, score: number) {
  if (category === "hot" || category === "warm" || category === "cold") return category;
  if (category === "general_enquiry") return category;
  if (score >= 80) return "hot";
  if (score >= 50) return "warm";
  return "cold";
}

function normalizeAgentType(value: unknown) {
  const allowed = new Set([
    "orchestrator",
    "qualification",
    "property_matching",
    "appointment",
    "followup",
    "escalation",
    "n8n_dispatch",
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "orchestrator";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

async function propertyBelongsToOrg(propertyId: string, organizationId: string) {
  const { data } = await supabaseAdmin()
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data);
}

async function computeSendAllowed(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    organizationId: string;
    conversationId: string;
    contactId: string;
    duplicate: boolean;
  },
) {
  if (args.duplicate) return false;
  const [{ data: contact }, { data: conversation }, { data: latestInbound }, { data: template }] =
    await Promise.all([
      db
        .from("contacts")
        .select("opted_out")
        .eq("id", args.contactId)
        .eq("organization_id", args.organizationId)
        .maybeSingle(),
      db
        .from("conversations")
        .select("automation_mode, automation_paused, assigned_agent_id")
        .eq("id", args.conversationId)
        .eq("organization_id", args.organizationId)
        .maybeSingle(),
      db
        .from("messages")
        .select("created_at")
        .eq("conversation_id", args.conversationId)
        .eq("sender_type", "customer")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("message_templates")
        .select("id")
        .eq("organization_id", args.organizationId)
        .eq("status", "Approved")
        .limit(1)
        .maybeSingle(),
    ]);

  if ((contact as { opted_out?: boolean } | null)?.opted_out) return false;
  const conv = conversation as
    | { automation_mode?: string; automation_paused?: boolean; assigned_agent_id?: string | null }
    | null;
  if (conv?.automation_mode === "human" || conv?.automation_paused || conv?.assigned_agent_id) {
    return false;
  }
  const inboundAt = (latestInbound as { created_at?: string } | null)?.created_at;
  if (!inboundAt) return Boolean(template);
  const withinWindow = Date.now() - new Date(inboundAt).getTime() <= 24 * 60 * 60 * 1000;
  return withinWindow || Boolean(template);
}

async function clearStaleAgentModeHandoff(args: {
  organizationId: string;
  conversationId: string;
}) {
  const db = supabaseAdmin();
  await db
    .from("human_handoffs")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", args.organizationId)
    .eq("conversation_id", args.conversationId)
    .in("status", ["open", "accepted"]);

  await db
    .from("conversations")
    .update({
      automation_mode: "agent",
      automation_paused: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .eq("automation_mode", "agent");
}
