import { describe, expect, it } from "vitest";
import { evaluateN8nSendConversationState } from "./route";

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
