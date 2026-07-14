import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/internal-secret";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

export interface N8nEventEnvelope {
  organization_id?: string;
  conversation_id?: string;
  contact_id?: string;
  message_id?: string;
  event_id?: string;
  customer_phone?: string;
  customer_name?: string;
  message_text?: string;
}

export interface ResolvedRealEstateContext {
  organizationId: string;
  conversation: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
}

export async function resolveRealEstateContext(
  db: SupabaseClient,
  event: N8nEventEnvelope,
): Promise<ResolvedRealEstateContext | { error: string; status: number }> {
  let conversation: Record<string, unknown> | null = null;
  let contact: Record<string, unknown> | null = null;
  const inboundOrganizationId = normalizeInboundOrganizationId(event.organization_id);
  if (inboundOrganizationId === "invalid") {
    return { error: "organization_id must be a valid UUID or omitted", status: 400 };
  }
  let organizationId =
    typeof inboundOrganizationId === "string" ? inboundOrganizationId : null;

  if (isUuid(event.conversation_id)) {
    const { data, error } = await db
      .from("conversations")
      .select("*")
      .eq("id", event.conversation_id)
      .maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Conversation not found", status: 404 };
    conversation = data as Record<string, unknown>;
    organizationId = resolveCanonicalOrganizationId({
      current: organizationId,
      resolved: conversation.organization_id,
    });
  }

  const contactId =
    isUuid(event.contact_id)
      ? event.contact_id
      : typeof conversation?.contact_id === "string"
        ? conversation.contact_id
        : null;

  if (contactId) {
    const { data, error } = await db
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Contact not found", status: 404 };
    contact = data as Record<string, unknown>;
    organizationId = resolveCanonicalOrganizationId({
      current: organizationId,
      resolved: contact.organization_id,
    });
  }

  if (!contact && event.customer_phone) {
    const phoneResult = await findContactByPhone(db, {
      phone: event.customer_phone,
      organizationId,
    });
    if ("error" in phoneResult) return phoneResult;
    contact = phoneResult.contact;
    if (contact) {
      organizationId = resolveCanonicalOrganizationId({
        current: organizationId,
        resolved: contact.organization_id,
      });
    }
  }

  if (!conversation && contact?.id && contact?.organization_id) {
    const { data, error } = await db
      .from("conversations")
      .select("*")
      .eq("organization_id", String(contact.organization_id))
      .eq("contact_id", String(contact.id))
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { error: error.message, status: 500 };
    conversation = (data as Record<string, unknown> | null) ?? null;
    if (conversation) {
      organizationId = resolveCanonicalOrganizationId({
        current: organizationId,
        resolved: conversation.organization_id,
      });
    }
  }

  if (!organizationId) {
    return { error: "organization_id could not be resolved", status: 400 };
  }

  if (
    typeof inboundOrganizationId === "string" &&
    inboundOrganizationId !== organizationId
  ) {
    return { error: "Organization mismatch", status: 403 };
  }

  if (conversation?.organization_id && conversation.organization_id !== organizationId) {
    return { error: "Conversation does not belong to organization", status: 403 };
  }

  if (contact?.organization_id && contact.organization_id !== organizationId) {
    return { error: "Contact does not belong to organization", status: 403 };
  }

  if (
    conversation?.contact_id &&
    contact?.id &&
    String(conversation.contact_id) !== String(contact.id)
  ) {
    return { error: "Conversation/contact mismatch", status: 403 };
  }

  return { organizationId, conversation, contact };
}

export function normalizeInboundOrganizationId(value: unknown) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower === "default-org" ||
    lower === "unknown" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return null;
  }
  return isUuid(trimmed) ? trimmed : "invalid";
}

function resolveCanonicalOrganizationId(args: {
  current: string | null;
  resolved: unknown;
}) {
  const resolved = typeof args.resolved === "string" ? args.resolved : "";
  return args.current ?? resolved;
}

async function findContactByPhone(
  db: SupabaseClient,
  args: { phone: string; organizationId: string | null },
): Promise<
  | { contact: Record<string, unknown> | null }
  | { error: string; status: number }
> {
  const target = normalizePhone(args.phone);
  if (!target) return { contact: null };

  let query = db.from("contacts").select("*");
  if (args.organizationId) {
    query = query.eq("organization_id", args.organizationId);
  }
  const { data, error } = await query.limit(100);
  if (error) return { error: error.message, status: 500 };

  const matches = ((data ?? []) as Array<Record<string, unknown>>).filter((row) =>
    phonesMatch(String(row.phone ?? ""), target),
  );
  if (matches.length > 1) {
    return { error: "customer_phone matched multiple contacts", status: 409 };
  }
  return { contact: matches[0] ?? null };
}

export async function getEventDuplicateState(
  db: SupabaseClient,
  args: { organizationId: string; eventId?: string; messageId?: string },
) {
  const [eventStatusResult, messageResult] = await Promise.all([
    args.eventId
      ? db
          .from("n8n_event_statuses")
          .select("status")
          .eq("organization_id", args.organizationId)
          .eq("event_id", args.eventId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    args.messageId
      ? db
          .from("agent_activity_logs")
          .select("id")
          .eq("organization_id", args.organizationId)
          .like("idempotency_key", `%${args.messageId}%`)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    event_is_duplicate: Boolean(eventStatusResult.data || messageResult.data),
    event_already_completed:
      (eventStatusResult.data as { status?: string } | null)?.status === "completed",
  };
}
