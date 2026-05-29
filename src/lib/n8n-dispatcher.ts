import { createClient } from "@/lib/supabase/server";
import type { N8nEvent, N8nWorkflowRecord } from "@/lib/n8n-types";

export interface N8nPayload {
  event: N8nEvent;
  payload: Record<string, unknown>;
  timestamp: string;
  source: "huygen-warp";
}

export async function dispatchN8nEvent(
  event: N8nEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = await createClient();

    const { data: workflows } = await supabase
      .from("n8n_workflows")
      .select("*")
      .eq("trigger_event", event)
      .eq("is_active", true);

    if (!workflows?.length) return;

    const body: N8nPayload = {
      event,
      payload,
      timestamp: new Date().toISOString(),
      source: "huygen-warp",
    };

    await Promise.allSettled(
      (workflows as N8nWorkflowRecord[]).map(async (workflow) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (workflow.secret_token) {
          const { createHmac } = await import("crypto");
          const signature = createHmac("sha256", workflow.secret_token)
            .update(JSON.stringify(body))
            .digest("hex");
          headers["X-Huygen-Signature"] = `sha256=${signature}`;
        }

        let statusCode = 0;
        let errorMessage: string | null = null;

        try {
          const response = await fetch(workflow.webhook_url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
          });
          statusCode = response.status;
        } catch (error) {
          errorMessage =
            error instanceof Error ? error.message : "Unknown fetch error";
          statusCode = 0;
        }

        void supabase
          .from("n8n_workflows")
          .update({
            last_triggered_at: new Date().toISOString(),
            last_status_code: statusCode,
            last_error: errorMessage,
            execution_count: (workflow.execution_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", workflow.id);
      }),
    );
  } catch {
    // Intentional no-op: n8n dispatch must never break CRM flows.
  }
}

/*
 TODO integration points (append-only in existing handlers):
 - message.received: dispatchN8nEvent("message.received", { contactId, message, customerPhone, messageId })
 - message.sent: dispatchN8nEvent("message.sent", { contactId, message, to: customerPhone })
 - contact.created: dispatchN8nEvent("contact.created", { contact })
 - contact.updated: dispatchN8nEvent("contact.updated", { contactId, changes })
 - deal.created: dispatchN8nEvent("deal.created", { deal })
 - deal.stage_changed: dispatchN8nEvent("deal.stage_changed", { dealId, oldStage, newStage })
*/
