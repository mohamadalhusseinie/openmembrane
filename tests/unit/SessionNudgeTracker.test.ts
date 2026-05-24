import { describe, expect, it } from "vitest";
import { SessionNudgeTracker } from "../../apps/mcp-server/src/nudge/SessionNudgeTracker";
import type { NudgeConfig } from "../../apps/mcp-server/src/nudge/nudgeConfig";

function defaultConfig(overrides: Partial<NudgeConfig> = {}): NudgeConfig {
  return {
    enabled: true,
    threshold: 3,
    escalation: 3,
    reNudgeAfter: 5,
    ...overrides
  };
}

describe("SessionNudgeTracker", () => {
  describe("escalation levels", () => {
    it("returns Level 0 message on the very first tool call", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      const reminder = tracker.recordToolCall("get_project_rules");
      expect(reminder).toContain("durable knowledge from previous work");
    });

    it("returns undefined for calls 2 through threshold-1", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      tracker.recordToolCall("get_project_rules"); // call 1 → Level 0
      expect(tracker.recordToolCall("get_relevant_context")).toBeUndefined(); // call 2
    });

    it("returns Level 1 message at threshold (call 3)", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      tracker.recordToolCall("get_project_rules"); // 1
      tracker.recordToolCall("get_relevant_context"); // 2
      const reminder = tracker.recordToolCall("search_memory"); // 3 (threshold)
      expect(reminder).toContain("No memories saved this session");
      expect(reminder).toContain("remember({ content, type })");
    });

    it("returns Level 1 for calls between threshold and threshold+escalation", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 4; i++) tracker.recordToolCall("some_tool");
      const reminder = tracker.recordToolCall("some_tool"); // call 5
      expect(reminder).toContain("No memories saved this session");
    });

    it("returns Level 2 message at threshold+escalation (call 6)", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 5; i++) tracker.recordToolCall("some_tool");
      const reminder = tracker.recordToolCall("some_tool"); // call 6
      expect(reminder).toContain("You have made 6 tool calls without saving any memories");
      expect(reminder).toContain("remember({ content:");
    });

    it("returns Level 2 for calls between threshold+escalation and threshold+2*escalation", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 7; i++) tracker.recordToolCall("some_tool");
      const reminder = tracker.recordToolCall("some_tool"); // call 8
      expect(reminder).toContain("You have made 8 tool calls without saving any memories");
    });

    it("returns Level 3 message at threshold+2*escalation (call 9)", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 8; i++) tracker.recordToolCall("some_tool");
      const reminder = tracker.recordToolCall("some_tool"); // call 9
      expect(reminder).toContain("IMPORTANT");
      expect(reminder).toContain("9 interactions");
      expect(reminder).toContain("remember({ content:");
    });

    it("continues Level 3 for all calls beyond threshold+2*escalation", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 11; i++) tracker.recordToolCall("some_tool");
      const reminder = tracker.recordToolCall("some_tool"); // call 12
      expect(reminder).toContain("IMPORTANT");
      expect(reminder).toContain("12 interactions");
    });
  });

  describe("reset behavior after save", () => {
    it("stops reminders immediately after recordMemorySaved", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 5; i++) tracker.recordToolCall("some_tool");
      // At this point call 5 would give Level 1

      tracker.recordMemorySaved();

      const reminder = tracker.recordToolCall("some_tool"); // call 6
      expect(reminder).toBeUndefined();
    });

    it("resets callsSinceLastSave to 0 on save", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      for (let i = 0; i < 5; i++) tracker.recordToolCall("some_tool");
      tracker.recordMemorySaved();

      const state = tracker.getState();
      expect(state.callsSinceLastSave).toBe(0);
      expect(state.memorySavedThisSession).toBe(true);
    });
  });

  describe("re-nudge after save", () => {
    it("returns Level 1 re-nudge after reNudgeAfter calls since last save", () => {
      const tracker = new SessionNudgeTracker(defaultConfig({ reNudgeAfter: 5 }));
      // Simulate initial calls and save
      tracker.recordToolCall("get_project_rules"); // 1
      tracker.recordToolCall("remember"); // 2
      tracker.recordMemorySaved();

      // 5 more calls without saving
      for (let i = 0; i < 4; i++) {
        expect(tracker.recordToolCall("some_tool")).toBeUndefined();
      }
      const reminder = tracker.recordToolCall("some_tool"); // 5th call since save
      expect(reminder).toContain("No memories saved this session");
    });

    it("stops re-nudge after another save", () => {
      const tracker = new SessionNudgeTracker(defaultConfig({ reNudgeAfter: 5 }));
      tracker.recordToolCall("get_project_rules");
      tracker.recordMemorySaved();

      for (let i = 0; i < 5; i++) tracker.recordToolCall("some_tool");
      // Should be re-nudging now
      expect(tracker.recordToolCall("some_tool")).toContain("No memories saved");

      tracker.recordMemorySaved();
      expect(tracker.recordToolCall("some_tool")).toBeUndefined();
    });
  });

  describe("disabled via config", () => {
    it("always returns undefined when enabled is false", () => {
      const tracker = new SessionNudgeTracker(defaultConfig({ enabled: false }));
      for (let i = 0; i < 15; i++) {
        expect(tracker.recordToolCall("some_tool")).toBeUndefined();
      }
    });
  });

  describe("isSaveOperation", () => {
    it("returns true for remember", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      expect(tracker.isSaveOperation("remember")).toBe(true);
    });

    it("returns true for propose_memory_from_session", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      expect(tracker.isSaveOperation("propose_memory_from_session")).toBe(true);
    });

    it("returns false for other operations", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      expect(tracker.isSaveOperation("get_project_rules")).toBe(false);
      expect(tracker.isSaveOperation("search_memory")).toBe(false);
    });
  });

  describe("getState", () => {
    it("reflects initial state", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      const state = tracker.getState();
      expect(state.toolCallCount).toBe(0);
      expect(state.memorySavedThisSession).toBe(false);
      expect(state.callsSinceLastSave).toBe(0);
      expect(state.firstToolCallAt).toBeUndefined();
    });

    it("reflects state after calls and saves", () => {
      const tracker = new SessionNudgeTracker(defaultConfig());
      tracker.recordToolCall("get_project_rules");
      tracker.recordToolCall("remember");
      tracker.recordMemorySaved();
      tracker.recordToolCall("search_memory");

      const state = tracker.getState();
      expect(state.toolCallCount).toBe(3);
      expect(state.memorySavedThisSession).toBe(true);
      expect(state.callsSinceLastSave).toBe(1);
      expect(state.firstToolCallAt).toBeDefined();
    });
  });
});
