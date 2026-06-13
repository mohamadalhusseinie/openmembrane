import { describe, it, expect } from "vitest";
import { parseExtractionResponse } from "@openmembrane/core";

describe("parseExtractionResponse", () => {
  const projectId = "proj_test123";

  it("parses valid JSON array with complete objects", () => {
    const raw = JSON.stringify([
      {
        content: "Always use strict mode",
        type: "coding_rule",
        scope: "global",
        confidence: "high",
        sensitivity: "public",
        recommendedAction: "auto_save",
        reason: "Best practice",
        tags: ["typescript"],
      },
    ]);
    const result = parseExtractionResponse(raw, projectId);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Always use strict mode");
    expect(result[0]!.type).toBe("coding_rule");
    expect(result[0]!.scope).toBe("global");
    expect(result[0]!.confidence).toBe("high");
    expect(result[0]!.sensitivity).toBe("public");
    expect(result[0]!.recommendedAction).toBe("auto_save");
    expect(result[0]!.reason).toBe("Best practice");
    expect(result[0]!.tags).toEqual(["typescript"]);
    expect(result[0]!.projectId).toBe(projectId);
    expect(result[0]!.id).toMatch(/^cand_/);
    expect(result[0]!.source).toEqual({ kind: "session" });
  });

  it("applies safe defaults for missing fields", () => {
    const raw = JSON.stringify([{ content: "Some fact" }]);
    const result = parseExtractionResponse(raw, projectId);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("project_fact");
    expect(result[0]!.scope).toBe("unknown");
    expect(result[0]!.confidence).toBe("medium");
    expect(result[0]!.sensitivity).toBe("internal");
    expect(result[0]!.recommendedAction).toBe("ask_user");
    expect(result[0]!.reason).toBe("Extracted by LLM");
    expect(result[0]!.tags).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseExtractionResponse("not json at all", projectId)).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseExtractionResponse('{"key": "value"}', projectId)).toEqual([]);
  });

  it("skips items missing content", () => {
    const raw = JSON.stringify([
      { content: "valid" },
      { type: "coding_rule" },
      { content: "" },
      { content: 123 },
    ]);
    const result = parseExtractionResponse(raw, projectId);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("valid");
  });

  it("falls back for unknown enum values", () => {
    const raw = JSON.stringify([
      {
        content: "test",
        type: "invalid_type",
        scope: "mars",
        confidence: "super",
        sensitivity: "top_secret",
        recommendedAction: "ignore",
      },
    ]);
    const result = parseExtractionResponse(raw, projectId);
    expect(result[0]!.type).toBe("project_fact");
    expect(result[0]!.scope).toBe("unknown");
    expect(result[0]!.confidence).toBe("medium");
    expect(result[0]!.sensitivity).toBe("internal");
    expect(result[0]!.recommendedAction).toBe("ask_user");
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseExtractionResponse("[]", projectId)).toEqual([]);
  });

  it("extracts array from wrapper object", () => {
    const raw = JSON.stringify({
      memories: [{ content: "wrapped fact" }],
    });
    const result = parseExtractionResponse(raw, projectId);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("wrapped fact");
  });

  it("preserves valid tags array, defaults non-array to []", () => {
    const raw = JSON.stringify([
      { content: "a", tags: ["x", "y"] },
      { content: "b", tags: "not-array" },
      { content: "c", tags: [1, 2] },
    ]);
    const result = parseExtractionResponse(raw, projectId);
    expect(result[0]!.tags).toEqual(["x", "y"]);
    expect(result[1]!.tags).toEqual([]);
    expect(result[2]!.tags).toEqual([]);
  });

  it("attaches sessionId and tool to source when provided", () => {
    const raw = JSON.stringify([{ content: "some fact" }]);
    const result = parseExtractionResponse(raw, projectId, {
      sessionId: "sess_123",
      tool: "opencode",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toEqual({
      kind: "session",
      sessionId: "sess_123",
      tool: "opencode",
    });
  });

  it("omits sessionId and tool from source when not provided", () => {
    const raw = JSON.stringify([{ content: "some fact" }]);
    const result = parseExtractionResponse(raw, projectId);
    expect(result[0]!.source).toEqual({ kind: "session" });
  });
});
