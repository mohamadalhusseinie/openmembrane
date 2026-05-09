import { describe, expect, it } from "vitest";
import { MemoryClassifier } from "@openmembrain/core";
import { candidate } from "./helpers";

const classifier = new MemoryClassifier();

describe("MemoryClassifier", () => {
  describe("classify — sensitivity", () => {
    it("classifies content with embedded secret as secret", () => {
      const result = classifier.classify(
        candidate({ content: "The API key is sk-proj-abcdefghijklmnopqrstuvwxyz1234567890." })
      );
      expect(result.sensitivity).toBe("secret");
    });

    it("classifies content with REDACTED marker as secret", () => {
      const result = classifier.classify(
        candidate({ content: "Key was [REDACTED:openai_api_key] for prod." })
      );
      expect(result.sensitivity).toBe("secret");
    });

    it("classifies content with 'customer' keyword as confidential", () => {
      const result = classifier.classify(candidate({ content: "Customer data must be encrypted." }));
      expect(result.sensitivity).toBe("confidential");
    });

    it("classifies content with 'PII' keyword as confidential", () => {
      const result = classifier.classify(candidate({ content: "This endpoint returns PII fields." }));
      expect(result.sensitivity).toBe("confidential");
    });

    it("classifies content with 'credential' keyword as confidential", () => {
      const result = classifier.classify(candidate({ content: "Store credential in vault only." }));
      expect(result.sensitivity).toBe("confidential");
    });

    it("classifies content with 'password' keyword as confidential", () => {
      const result = classifier.classify(candidate({ content: "Never log password values." }));
      expect(result.sensitivity).toBe("confidential");
    });

    it("classifies security_rule type as confidential", () => {
      const result = classifier.classify(candidate({ type: "security_rule", sensitivity: "public" }));
      expect(result.sensitivity).toBe("confidential");
    });

    it("classifies security scope as confidential", () => {
      const result = classifier.classify(
        candidate({ scope: "security", sensitivity: "public", type: "coding_rule" })
      );
      expect(result.sensitivity).toBe("confidential");
    });

    it("classifies content with 'open source' keyword as public", () => {
      const result = classifier.classify(
        candidate({ content: "This is an open source library.", sensitivity: "internal" })
      );
      expect(result.sensitivity).toBe("public");
    });

    it("classifies content with 'public api' keyword as public", () => {
      const result = classifier.classify(
        candidate({ content: "The public api uses REST.", sensitivity: "internal" })
      );
      expect(result.sensitivity).toBe("public");
    });

    it("falls back to original sensitivity when no override applies", () => {
      const result = classifier.classify(candidate({ sensitivity: "internal" }));
      expect(result.sensitivity).toBe("internal");
    });
  });

  describe("classify — tag normalization", () => {
    it("lowercases tags", () => {
      const result = classifier.classify(candidate({ tags: ["React", "TYPESCRIPT"] }));
      expect(result.tags).toEqual(["react", "typescript"]);
    });

    it("deduplicates tags", () => {
      const result = classifier.classify(candidate({ tags: ["react", "React", "REACT"] }));
      expect(result.tags).toEqual(["react"]);
    });

    it("trims whitespace from tags", () => {
      const result = classifier.classify(candidate({ tags: [" react ", " angular "] }));
      expect(result.tags).toEqual(["react", "angular"]);
    });

    it("removes empty tags", () => {
      const result = classifier.classify(candidate({ tags: ["react", "", "  ", "angular"] }));
      expect(result.tags).toEqual(["react", "angular"]);
    });
  });
});
