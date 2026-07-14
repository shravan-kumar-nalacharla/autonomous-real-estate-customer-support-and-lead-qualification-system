import { describe, expect, it } from "vitest";
import { buildWebhookBody } from "./engine";

describe("buildWebhookBody", () => {
  it("builds a complete default payload when custom body template is empty", () => {
    const body = buildWebhookBody("", {
      context: {
        organization_id: "85b1f316-b942-426e-b3b5-a84988ae717d",
        conversation_id: "ff24823e-a746-4af9-94f0-c54f3876de78",
        contact_id: "a5ef2c68-98e7-48b4-9e69-977bc313d546",
        message_id: "msg-row-1",
        message_text: "Looking for a plot in Hyderabad under 80 lakh",
        customer_phone: "917993406266",
        customer_name: "Shravan",
        automation_mode: "agent",
      },
    });

    expect(JSON.parse(body)).toMatchObject({
      organization_id: "85b1f316-b942-426e-b3b5-a84988ae717d",
      conversation_id: "ff24823e-a746-4af9-94f0-c54f3876de78",
      contact_id: "a5ef2c68-98e7-48b4-9e69-977bc313d546",
      message_id: "msg-row-1",
      message_text: "Looking for a plot in Hyderabad under 80 lakh",
      customer_phone: "917993406266",
      customer_name: "Shravan",
      automation_mode: "agent",
    });
  });
});
