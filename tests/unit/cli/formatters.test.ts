import { describe, expect, it } from "vitest";
import { formatMemories } from "../../../apps/mcp-server/src/cli/formatters";
import { entry } from "../helpers.js";

describe("formatMemories", () => {
  describe("text format", () => {
    it("formats memories as human-readable text", () => {
      const memories = [
        entry({ id: "mem_1", type: "coding_rule", scope: "frontend", content: "Use tabs.", tags: [] }),
        entry({ id: "mem_2", type: "known_gotcha", scope: "backend", content: "Watch for race conditions.", tags: ["concurrency"] })
      ];
      const result = formatMemories(memories, "text");
      expect(result).toContain("Found 2 memories:");
      expect(result).toContain("[coding_rule] (frontend) Use tabs.");
      expect(result).toContain("[known_gotcha] (backend) Watch for race conditions. [concurrency]");
    });

    it("returns 'No memories found.' when empty", () => {
      expect(formatMemories([], "text")).toBe("No memories found.");
    });

    it("uses singular 'memory' for one entry", () => {
      const result = formatMemories([entry()], "text");
      expect(result).toContain("Found 1 memory:");
    });
  });

  describe("json format", () => {
    it("formats memories as JSON array", () => {
      const memories = [entry({ id: "mem_1", content: "Test rule" })];
      const result = formatMemories(memories, "json");
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("mem_1");
      expect(parsed[0].content).toBe("Test rule");
    });

    it("returns empty array for no memories", () => {
      expect(formatMemories([], "json")).toBe("[]");
    });
  });

  describe("markdown format", () => {
    it("groups memories by type with headers", () => {
      const memories = [
        entry({ type: "coding_rule", scope: "frontend", content: "Rule 1" }),
        entry({ type: "coding_rule", scope: "backend", content: "Rule 2" }),
        entry({ type: "known_gotcha", scope: "global", content: "Gotcha 1" })
      ];
      const result = formatMemories(memories, "markdown");
      expect(result).toContain("## coding rule");
      expect(result).toContain("- [frontend] Rule 1");
      expect(result).toContain("- [backend] Rule 2");
      expect(result).toContain("## known gotcha");
      expect(result).toContain("- [global] Gotcha 1");
    });
  });
});
