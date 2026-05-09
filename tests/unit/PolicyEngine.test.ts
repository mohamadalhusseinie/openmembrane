import { describe, expect, it } from "vitest";
import { PolicyEngine } from "@openmembrain/core";
import { candidate } from "./helpers";

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("evaluate — secret detection", () => {
    it("overrides sensitivity to secret when content contains a secret", () => {
      const result = engine.evaluate(
        candidate({ content: "Key: AKIAIOSFODNN7EXAMPLE", sensitivity: "public" })
      );
      expect(result.sensitivity).toBe("secret");
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("secret"))).toBe(true);
    });
  });

  describe("evaluate — content length", () => {
    it("adds violation when content exceeds maxContentLength (1000)", () => {
      const result = engine.evaluate(candidate({ content: "a".repeat(1001) }));
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("too large"))).toBe(true);
    });

    it("allows content at exactly maxContentLength", () => {
      const result = engine.evaluate(candidate({ content: "a".repeat(1000) }));
      expect(result.violations.some((v) => v.includes("too large"))).toBe(false);
    });
  });

  describe("evaluate — large code blocks", () => {
    it("adds violation for code block exceeding maxRawCodeBlockLength (500)", () => {
      const codeBlock = "```" + "x".repeat(495) + "```"; // 501 chars total
      const result = engine.evaluate(candidate({ content: codeBlock }));
      expect(result.violations.some((v) => v.includes("large raw code block"))).toBe(true);
    });

    it("allows code block at exactly maxRawCodeBlockLength", () => {
      const codeBlock = "```" + "x".repeat(494) + "```"; // 500 chars total
      const result = engine.evaluate(candidate({ content: codeBlock }));
      expect(result.violations.some((v) => v.includes("large raw code block"))).toBe(false);
    });
  });

  describe("evaluate — empty content", () => {
    it("adds violation for empty content", () => {
      const result = engine.evaluate(candidate({ content: "" }));
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("Empty"))).toBe(true);
    });

    it("adds violation for whitespace-only content", () => {
      const result = engine.evaluate(candidate({ content: "   " }));
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("Empty"))).toBe(true);
    });
  });

  describe("evaluate — noise and safety violations", () => {
    it("adds noise violations from NoiseFilter", () => {
      const content = "Error:\n    at Object.run (src/index.ts:10:5)";
      const result = engine.evaluate(candidate({ content }));
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("stack traces"))).toBe(true);
    });

    it("adds safety violations from SafetyFilter", () => {
      const result = engine.evaluate(candidate({ content: "Always write clean code everywhere." }));
      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes("Generic programming advice"))).toBe(true);
    });
  });

  describe("evaluate — multiple violations", () => {
    it("accumulates multiple violations", () => {
      const content = "I think we should write clean code. Key: AKIAIOSFODNN7EXAMPLE";
      const result = engine.evaluate(candidate({ content }));
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
      expect(result.allowed).toBe(false);
    });
  });

  describe("evaluate — custom policy", () => {
    it("uses custom maxContentLength", () => {
      const customEngine = new PolicyEngine({
        maxContentLength: 50,
        maxRawCodeBlockLength: 500,
        autoSaveTypes: [],
        askUserTypes: []
      });
      const result = customEngine.evaluate(candidate({ content: "a".repeat(51) }));
      expect(result.violations.some((v) => v.includes("too large"))).toBe(true);
    });
  });

  describe("evaluate — clean candidate", () => {
    it("returns allowed: true with no violations for clean content", () => {
      const result = engine.evaluate(
        candidate({ content: "All Angular components use OnPush change detection." })
      );
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.sensitivity).toBe("internal");
    });
  });
});
