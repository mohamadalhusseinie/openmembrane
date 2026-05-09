import { describe, expect, it } from "vitest";
import { ActionRecommender } from "@openmembrain/core";
import { candidate } from "./helpers";

const recommender = new ActionRecommender();
const noFlags = { hasConflict: false, isDuplicate: false };

describe("ActionRecommender", () => {
  describe("recommend — reject", () => {
    it("rejects secret sensitivity", () => {
      const result = recommender.recommend(candidate({ sensitivity: "secret" }), noFlags);
      expect(result).toBe("reject");
    });

    it("rejects low confidence", () => {
      const result = recommender.recommend(candidate({ confidence: "low" }), noFlags);
      expect(result).toBe("reject");
    });

    it("rejects duplicates", () => {
      const result = recommender.recommend(candidate(), { hasConflict: false, isDuplicate: true });
      expect(result).toBe("reject");
    });
  });

  describe("recommend — ask_user", () => {
    it("asks user when hasConflict is true", () => {
      const result = recommender.recommend(candidate(), { hasConflict: true, isDuplicate: false });
      expect(result).toBe("ask_user");
    });

    it("asks user for architecture_decision type", () => {
      const result = recommender.recommend(candidate({ type: "architecture_decision" }), noFlags);
      expect(result).toBe("ask_user");
    });

    it("asks user for security_rule type", () => {
      const result = recommender.recommend(candidate({ type: "security_rule" }), noFlags);
      expect(result).toBe("ask_user");
    });

    it("asks user for deployment_rule type", () => {
      const result = recommender.recommend(candidate({ type: "deployment_rule" }), noFlags);
      expect(result).toBe("ask_user");
    });

    it("asks user for forbidden_pattern type", () => {
      const result = recommender.recommend(candidate({ type: "forbidden_pattern" }), noFlags);
      expect(result).toBe("ask_user");
    });

    it("asks user for session_summary type", () => {
      const result = recommender.recommend(candidate({ type: "session_summary" }), noFlags);
      expect(result).toBe("ask_user");
    });

    it("asks user for confidential sensitivity", () => {
      const result = recommender.recommend(
        candidate({ type: "project_fact", sensitivity: "confidential" }),
        noFlags
      );
      expect(result).toBe("ask_user");
    });
  });

  describe("recommend — auto_save", () => {
    it("auto-saves high-confidence project_fact with public sensitivity", () => {
      const result = recommender.recommend(
        candidate({ type: "project_fact", confidence: "high", sensitivity: "public" }),
        noFlags
      );
      expect(result).toBe("auto_save");
    });

    it("auto-saves high-confidence coding_rule with internal sensitivity", () => {
      const result = recommender.recommend(
        candidate({ type: "coding_rule", confidence: "high", sensitivity: "internal" }),
        noFlags
      );
      expect(result).toBe("auto_save");
    });

    it("auto-saves high-confidence testing_rule with public sensitivity", () => {
      const result = recommender.recommend(
        candidate({ type: "testing_rule", confidence: "high", sensitivity: "public" }),
        noFlags
      );
      expect(result).toBe("auto_save");
    });
  });

  describe("recommend — fallback", () => {
    it("falls back to ask_user for medium confidence project_fact", () => {
      const result = recommender.recommend(
        candidate({ type: "project_fact", confidence: "medium", sensitivity: "internal" }),
        noFlags
      );
      expect(result).toBe("ask_user");
    });

    it("falls back to ask_user for high confidence domain_knowledge", () => {
      const result = recommender.recommend(
        candidate({ type: "domain_knowledge", confidence: "high", sensitivity: "internal" }),
        noFlags
      );
      expect(result).toBe("ask_user");
    });
  });

  describe("recommend — priority ordering", () => {
    it("reject takes precedence over ask_user (secret + conflict)", () => {
      const result = recommender.recommend(
        candidate({ sensitivity: "secret" }),
        { hasConflict: true, isDuplicate: false }
      );
      expect(result).toBe("reject");
    });

    it("reject takes precedence over auto_save (low confidence + project_fact)", () => {
      const result = recommender.recommend(
        candidate({ type: "project_fact", confidence: "low", sensitivity: "public" }),
        noFlags
      );
      expect(result).toBe("reject");
    });
  });
});
