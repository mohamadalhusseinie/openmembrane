import { describe, expect, it } from "vitest";
import { SafetyFilter } from "@openmembrane/core";

const filter = new SafetyFilter();

describe("SafetyFilter", () => {
  describe("findUnsafeDurabilitySignals — generic advice", () => {
    it("detects 'write clean code'", () => {
      const findings = filter.findUnsafeDurabilitySignals("Always write clean code in every module.");
      expect(findings.some((f) => f.code === "generic_advice")).toBe(true);
    });

    it("detects 'use best practices'", () => {
      const findings = filter.findUnsafeDurabilitySignals("We should use best practices for error handling.");
      expect(findings.some((f) => f.code === "generic_advice")).toBe(true);
    });

    it("detects 'keep it simple'", () => {
      const findings = filter.findUnsafeDurabilitySignals("The team agreed to keep it simple.");
      expect(findings.some((f) => f.code === "generic_advice")).toBe(true);
    });
  });

  describe("findUnsafeDurabilitySignals — emotional commentary", () => {
    it("detects 'annoyed'", () => {
      const findings = filter.findUnsafeDurabilitySignals("The developer was annoyed by the bug.");
      expect(findings.some((f) => f.code === "emotional_commentary")).toBe(true);
    });

    it("detects 'frustrated'", () => {
      const findings = filter.findUnsafeDurabilitySignals("I felt frustrated with the deployment process.");
      expect(findings.some((f) => f.code === "emotional_commentary")).toBe(true);
    });

    it("detects 'the user was'", () => {
      const findings = filter.findUnsafeDurabilitySignals("The user was confused by the error message.");
      expect(findings.some((f) => f.code === "emotional_commentary")).toBe(true);
    });
  });

  describe("findUnsafeDurabilitySignals — unverified guesses", () => {
    it("detects 'maybe'", () => {
      const findings = filter.findUnsafeDurabilitySignals("Maybe we should use a different database.");
      expect(findings.some((f) => f.code === "unverified_guess")).toBe(true);
    });

    it("detects 'probably'", () => {
      const findings = filter.findUnsafeDurabilitySignals("This is probably caused by a race condition.");
      expect(findings.some((f) => f.code === "unverified_guess")).toBe(true);
    });

    it("detects 'i think'", () => {
      const findings = filter.findUnsafeDurabilitySignals("I think the issue is in the cache layer.");
      expect(findings.some((f) => f.code === "unverified_guess")).toBe(true);
    });

    it("detects 'seems like'", () => {
      const findings = filter.findUnsafeDurabilitySignals("It seems like the API is throttling requests.");
      expect(findings.some((f) => f.code === "unverified_guess")).toBe(true);
    });
  });

  describe("findUnsafeDurabilitySignals — multiple findings", () => {
    it("returns multiple findings when multiple signals present", () => {
      const content = "I think we should write clean code because the user was frustrated.";
      const findings = filter.findUnsafeDurabilitySignals(content);
      expect(findings.length).toBeGreaterThanOrEqual(3);
      const codes = findings.map((f) => f.code);
      expect(codes).toContain("generic_advice");
      expect(codes).toContain("emotional_commentary");
      expect(codes).toContain("unverified_guess");
    });
  });

  describe("findUnsafeDurabilitySignals — clean content passes", () => {
    it("returns empty for project-specific technical content", () => {
      const content = "All Angular components must use OnPush change detection strategy.";
      expect(filter.findUnsafeDurabilitySignals(content)).toHaveLength(0);
    });

    it("returns empty for concrete architecture decisions", () => {
      const content = "PostgreSQL is the primary database. Redis handles session caching.";
      expect(filter.findUnsafeDurabilitySignals(content)).toHaveLength(0);
    });
  });

  describe("findUnsafeDurabilitySignals — false positive risk", () => {
    it("flags legitimate technical use of 'maybe' as unverified guess (known false positive)", () => {
      const content = "Never use maybe-undefined types in strict mode.";
      const findings = filter.findUnsafeDurabilitySignals(content);
      expect(findings.some((f) => f.code === "unverified_guess")).toBe(true);
    });
  });
});
