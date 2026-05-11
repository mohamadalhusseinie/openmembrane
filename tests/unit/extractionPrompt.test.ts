import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  EXTRACTION_PROMPT_VERSION,
  memoryTypes,
  memoryScopes,
  confidenceValues,
  sensitivityValues,
  recommendedActions,
} from "@openmembrain/core";

describe("EXTRACTION_PROMPT_VERSION", () => {
  it("is a valid semver string", () => {
    expect(EXTRACTION_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("mentions durable project knowledge", () => {
    expect(prompt).toContain("durable project knowledge");
  });

  it("mentions JSON", () => {
    expect(prompt).toContain("JSON");
  });

  it("includes all memory type values", () => {
    for (const t of memoryTypes) {
      expect(prompt).toContain(t);
    }
  });

  it("includes all recommended action values", () => {
    for (const a of recommendedActions) {
      expect(prompt).toContain(a);
    }
  });

  it("mentions good memory criteria", () => {
    expect(prompt).toContain("good memory");
  });

  it("mentions bad memory criteria", () => {
    expect(prompt).toContain("bad memory");
  });

  it("includes type assignment guidance for all memory types", () => {
    expect(prompt).toContain("Type assignment guide");
    for (const t of memoryTypes) {
      expect(prompt).toContain(`"${t}"`);
    }
  });

  it("includes scope assignment guidance for all scopes", () => {
    expect(prompt).toContain("Scope assignment guide");
    for (const s of memoryScopes) {
      expect(prompt).toContain(`"${s}"`);
    }
  });

  it("includes confidence assignment rules with criteria for each level", () => {
    expect(prompt).toContain("Confidence assignment rules");
    for (const c of confidenceValues) {
      expect(prompt).toContain(`"${c}"`);
    }
  });

  it("includes sensitivity assignment rules with criteria for each level", () => {
    expect(prompt).toContain("Sensitivity assignment rules");
    for (const s of sensitivityValues) {
      expect(prompt).toContain(`"${s}"`);
    }
  });

  it("includes ambiguity handling guidance", () => {
    expect(prompt).toContain("ambiguity");
  });

  it("includes content formatting guidance", () => {
    expect(prompt).toContain("Content formatting");
  });

  it("instructs to never assign secret sensitivity", () => {
    expect(prompt).toContain('NEVER assign "secret"');
  });

  it("prefers ask_user over auto_save when uncertain", () => {
    expect(prompt).toContain("ask_user");
    expect(prompt).toContain("safer to ask");
  });

  it("instructs not to extract AI suggestions without user agreement", () => {
    expect(prompt).toContain("silence is not confirmation");
  });

  it("instructs standalone content formatting", () => {
    expect(prompt).toContain("standalone");
  });
});

describe("buildUserPrompt", () => {
  it("includes the session text", () => {
    expect(buildUserPrompt("some session text")).toContain("some session text");
  });

  it("works with empty string", () => {
    const result = buildUserPrompt("");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });
});
