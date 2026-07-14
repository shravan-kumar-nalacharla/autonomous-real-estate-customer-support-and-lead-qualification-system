import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/internal-secret";

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
  let organizationId = isUuid(event.organization_id) ? event.organization_id : null;

  if (isUuid(event.conversation_id)) {
    const { data, error } = await db
      .from("conversations")
      .select("*")
      .eq("id", event.conversation_id)
      .maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Conversation not found", status: 404 };
    conversation = data as Record<string, unknown>;
    organizationId = String(conversation.organization_id ?? organizationId ?? "");
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
    organizationId = String(contact.organization_id ?? organizationId ?? "");
  }

  if (!organizationId) {
    return { error: "organization_id could not be resolved", status: 400 };
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
