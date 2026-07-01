export const N8N_TRIGGER_EVENTS = [
  "message.received",
  "message.sent",
  "contact.created",
  "contact.updated",
  "lead.requirements_updated",
  "lead.category_changed",
  "lead.hot",
  "property.recommendation_created",
  "appointment.requested",
  "appointment.confirmed",
  "appointment.cancelled",
  "followup.created",
  "human_escalation.created",
  "deal.created",
  "deal.stage_changed",
  "broadcast.completed",
  "manual",
] as const;

export type N8nEvent = (typeof N8N_TRIGGER_EVENTS)[number];

export interface N8nWorkflowRecord {
  id: string;
  organization_id?: string | null;
  name: string;
  description: string | null;
  workflow_id: string | null;
  webhook_url: string;
  trigger_event: N8nEvent;
  is_active: boolean;
  n8n_instance_url: string | null;
  secret_token: string | null;
  last_triggered_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  execution_count: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SafeN8nWorkflowRecord
  extends Omit<N8nWorkflowRecord, "secret_token" | "webhook_url"> {
  secret_token?: never;
  webhook_url?: never;
  hasSecretConfigured: boolean;
  webhook_url_masked: string;
}

export interface N8nSettingsRecord {
  id: string;
  organization_id?: string | null;
  instance_url: string | null;
  api_key: string | null;
  is_connected: boolean | null;
  last_ping_at: string | null;
  last_ping_status: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SafeN8nSettingsRecord
  extends Omit<N8nSettingsRecord, "api_key"> {
  api_key?: never;
  hasApiKeyConfigured: boolean;
}

export const DEFAULT_N8N_INSTANCE_URL = "https://n8n-moof.onrender.com";

export const DEFAULT_WORKFLOW = {
  name: "WhatsApp AI Agent",
  description:
    "AI-powered WhatsApp responder - handles inbound messages, sends portfolio images, qualifies leads, and alerts the team on high-intent customers.",
  workflow_id: "k6PeCTOYS394tXjm",
  webhook_url:
    "https://n8n-moof.onrender.com/webhook/cc6a21a6-1cc0-4d6e-9dd9-69bb1ade13f6/webhook",
  trigger_event: "message.received" as const,
  is_active: true,
  n8n_instance_url: DEFAULT_N8N_INSTANCE_URL,
};

export const DEFAULT_SETTINGS = {
  instance_url: DEFAULT_N8N_INSTANCE_URL,
};

export function isN8nEvent(value: string): value is N8nEvent {
  return (N8N_TRIGGER_EVENTS as readonly string[]).includes(value);
}

export function maskUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const path = parsed.pathname;
    const suffix = path.length > 8 ? `...${path.slice(-6)}` : path;
    return `${parsed.origin}${suffix}`;
  } catch {
    return value.length <= 10 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
  }
}

export function toSafeWorkflow(
  workflow: N8nWorkflowRecord,
): SafeN8nWorkflowRecord {
  const {
    secret_token: secretToken,
    webhook_url: webhookUrl,
    ...rest
  } = workflow;
  return {
    ...rest,
    hasSecretConfigured: Boolean(secretToken),
    webhook_url_masked: maskUrl(webhookUrl) ?? "",
  };
}

export function toSafeSettings(
  settings: N8nSettingsRecord,
): SafeN8nSettingsRecord {
  const { api_key: apiKey, ...rest } = settings;
  return {
    ...rest,
    hasApiKeyConfigured: Boolean(apiKey),
  };
}
