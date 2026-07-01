import { describe, expect, it } from "vitest";
import { buildN8nSignature, sanitizePayload } from "./n8n-dispatcher";
import { toSafeSettings, toSafeWorkflow } from "./n8n-types";

describe("n8n security helpers", () => {
  it("masks workflow secrets and webhook URLs in API response shapes", () => {
    const safe = toSafeWorkflow({
      id: "wf-1",
      organization_id: "org-1",
      name: "Lead alerts",
      description: null,
      workflow_id: null,
      webhook_url: "https://n8n.example.com/webhook/super-secret-path",
      trigger_event: "lead.hot",
      is_active: true,
      n8n_instance_url: null,
      secret_token: "encrypted",
      last_triggered_at: null,
      last_status_code: null,
      last_error: null,
      execution_count: 0,
      created_at: null,
      updated_at: null,
    });

    expect("secret_token" in safe).toBe(false);
    expect("webhook_url" in safe).toBe(false);
    expect(safe.hasSecretConfigured).toBe(true);
    expect(safe.webhook_url_masked).toContain("https://n8n.example.com");
  });

  it("masks settings API keys in API response shapes", () => {
    const safe = toSafeSettings({
      id: "settings-1",
      organization_id: "org-1",
      instance_url: "https://n8n.example.com",
      api_key: "encrypted",
      is_connected: true,
      last_ping_at: null,
      last_ping_status: null,
      created_at: null,
      updated_at: null,
    });

    expect("api_key" in safe).toBe(false);
    expect(safe.hasApiKeyConfigured).toBe(true);
  });

  it("removes secret-looking payload keys and signs deterministically", () => {
    expect(
      sanitizePayload({
        contactId: "c1",
        api_key: "nope",
        webhook_url: "https://secret.example.com",
      }),
    ).toEqual({ contactId: "c1" });

    expect(buildN8nSignature("body", "secret")).toBe(
      "dc46983557fea127b43af721467eb9b3fde2338fe3e14f51952aa8478c13d355",
    );
  });
});
