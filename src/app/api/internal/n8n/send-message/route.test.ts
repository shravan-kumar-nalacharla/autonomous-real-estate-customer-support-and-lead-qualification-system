import { describe, expect, it } from "vitest";
import {
  evaluateN8nSendConversationState,
  normalizeInteractiveButtonPayload,
  reserveOutboundMessage,
} from "./route";

describe("evaluateN8nSendConversationState", () => {
  it("allows explicit agent-mode send with stale active handoff", () => {
    expect(
      evaluateN8nSendConversationState({
        automationMode: "agent",
        automationPaused: false,
        handoffActive: true,
        allowAgentModeSend: true,
      }),
    ).toEqual({ allowed: true, clearStaleHandoffAllowed: true });
  });

  it("blocks human mode even when agent-mode override is requested", () => {
    expect(
      evaluateN8nSendConversationState({
        automationMode: "human",
        automationPaused: false,
        handoffActive: true,
        allowAgentModeSend: true,
      }).allowed,
    ).toBe(false);
  });

  it("blocks paused automation even when agent-mode override is requested", () => {
    expect(
      evaluateN8nSendConversationState({
        automationMode: "agent",
        automationPaused: true,
        handoffActive: true,
        allowAgentModeSend: true,
      }).allowed,
    ).toBe(false);
  });

  it("blocks stale handoff in agent mode without explicit override", () => {
    expect(
      evaluateN8nSendConversationState({
        automationMode: "agent",
        automationPaused: false,
        handoffActive: true,
        allowAgentModeSend: false,
      }).allowed,
    ).toBe(false);
  });

  it("blocks manually assigned conversations without explicit override", () => {
    expect(
      evaluateN8nSendConversationState({
        automationMode: "agent",
        automationPaused: false,
        handoffActive: false,
        assignedAgentId: "agent-1",
        allowAgentModeSend: false,
      }).allowed,
    ).toBe(false);
  });

  it("blocks off/manual/paused modes", () => {
    for (const automationMode of ["manual", "paused", "off"]) {
      expect(
        evaluateN8nSendConversationState({
          automationMode,
          automationPaused: false,
          handoffActive: false,
          allowAgentModeSend: true,
        }).allowed,
      ).toBe(false);
    }
  });
});

describe("normalizeInteractiveButtonPayload", () => {
  const validPayload = {
    type: "button",
    body: { text: "Welcome. What would you like to do?" },
    action: {
      buttons: [
        { type: "reply", reply: { id: "find_property", title: "Find Property" } },
        {
          type: "reply",
          reply: { id: "book_site_visit", title: "Book Site Visit" },
        },
        { type: "reply", reply: { id: "talk_to_agent", title: "Talk to Agent" } },
      ],
    },
  };

  it("accepts interactive button payloads", () => {
    const result = normalizeInteractiveButtonPayload(validPayload);

    expect(result).toMatchObject({
      payload: {
        type: "button",
        body: { text: "Welcome. What would you like to do?" },
      },
    });
    expect("payload" in result ? result.payload.action.buttons : []).toHaveLength(3);
  });

  it("rejects more than 3 buttons", () => {
    const result = normalizeInteractiveButtonPayload({
      ...validPayload,
      action: {
        buttons: [
          ...validPayload.action.buttons,
          { type: "reply", reply: { id: "extra", title: "Extra" } },
        ],
      },
    });

    expect(result).toEqual({
      error: "Interactive button messages require 1-3 buttons",
    });
  });

  it("rejects missing body text", () => {
    const result = normalizeInteractiveButtonPayload({
      ...validPayload,
      body: { text: "" },
    });

    expect(result).toEqual({ error: "Interactive button body text is required" });
  });

  it("rejects missing reply ids and titles", () => {
    expect(
      normalizeInteractiveButtonPayload({
        ...validPayload,
        action: { buttons: [{ type: "reply", reply: { id: "", title: "Find" } }] },
      }),
    ).toEqual({ error: "Interactive button reply id is required" });

    expect(
      normalizeInteractiveButtonPayload({
        ...validPayload,
        action: { buttons: [{ type: "reply", reply: { id: "find", title: "" } }] },
      }),
    ).toEqual({ error: "Interactive button title is required" });
  });

  it("rejects unsupported interactive types", () => {
    expect(
      normalizeInteractiveButtonPayload({
        type: "list",
        body: { text: "Pick one" },
        action: { button: "Open", sections: [] },
      }),
    ).toEqual({ error: "Only interactive button messages are supported" });
  });
});

describe("reserveOutboundMessage", () => {
  it("creates a pending row before Meta send and returns duplicate on retry", async () => {
    const db = new ReservationDb();
    const first = await reserveOutboundMessage({
      db: db as never,
      organizationId: "org-1",
      conversationId: "conv-1",
      messageType: "interactive",
      contentText: "Welcome",
      imageMediaId: null,
      templateName: null,
      idempotencyKey: "n8n:outbound:1",
      rawPayload: { type: "button" },
      source: "n8n_real_estate_multi_agent",
    });
    const second = await reserveOutboundMessage({
      db: db as never,
      organizationId: "org-1",
      conversationId: "conv-1",
      messageType: "interactive",
      contentText: "Welcome",
      imageMediaId: null,
      templateName: null,
      idempotencyKey: "n8n:outbound:1",
      rawPayload: { type: "button" },
      source: "n8n_real_estate_multi_agent",
    });

    expect(first).toMatchObject({
      duplicate: false,
      message: { id: "msg-1", status: "sending" },
    });
    expect(second).toMatchObject({
      duplicate: true,
      message: { id: "msg-1", status: "sending" },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      content_type: "interactive",
      content_text: "Welcome",
      raw_payload: { type: "button" },
      source: "n8n_real_estate_multi_agent",
      status: "sending",
      idempotency_key: "n8n:outbound:1",
    });
  });
});

class ReservationDb {
  rows: Array<Record<string, unknown>> = [];

  from(table: string) {
    if (table !== "messages") throw new Error(`Unexpected table ${table}`);
    return new ReservationQuery(this);
  }
}

class ReservationQuery {
  private mode: "insert" | "select" | null = null;
  private insertPayload: Record<string, unknown> | null = null;
  private filters: Array<{ key: string; value: unknown }> = [];

  constructor(private readonly db: ReservationDb) {}

  insert(payload: Record<string, unknown>) {
    this.mode = "insert";
    this.insertPayload = payload;
    return this;
  }

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }

  async single() {
    if (this.mode !== "insert" || !this.insertPayload) {
      return { data: null, error: { message: "Unexpected single call" } };
    }
    const duplicate = this.db.rows.find(
      (row) =>
        row.organization_id === this.insertPayload?.organization_id &&
        row.idempotency_key === this.insertPayload?.idempotency_key,
    );
    if (duplicate) return { data: null, error: { message: "duplicate key" } };

    const row = { ...this.insertPayload, id: `msg-${this.db.rows.length + 1}` };
    this.db.rows.push(row);
    return {
      data: { id: row.id, message_id: row.message_id, status: row.status },
      error: null,
    };
  }

  async maybeSingle() {
    const row = this.db.rows.find((candidate) =>
      this.filters.every((filter) => candidate[filter.key] === filter.value),
    );
    return row
      ? {
          data: {
            id: row.id,
            message_id: row.message_id,
            status: row.status,
          },
          error: null,
        }
      : { data: null, error: null };
  }
}
