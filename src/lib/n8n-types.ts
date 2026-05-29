export const N8N_TRIGGER_EVENTS = [
  "message.received",
  "message.sent",
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.stage_changed",
  "broadcast.completed",
  "manual",
] as const;

export type N8nEvent = (typeof N8N_TRIGGER_EVENTS)[number];

export interface N8nWorkflowRecord {
  id: string;
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

export interface N8nSettingsRecord {
  id: string;
  instance_url: string | null;
  api_key: string | null;
  is_connected: boolean | null;
  last_ping_at: string | null;
  last_ping_status: number | null;
  created_at: string | null;
  updated_at: string | null;
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
