import { describe, expect, it } from "vitest";
import { Deduplicator, normalizeMemoryContent } from "@openmembrain/core";
import { candidate, entry } from "./helpers";

const deduplicator = new Deduplicator();

describe("normalizeMemoryContent", () => {
  it("lowercases text", () => {
    expect(normalizeMemoryContent("HELLO World")).toBe("hello world");
  });

  it("strips punctuation and collapses whitespace", () => {
    expect(normalizeMemoryContent("hello, world! (test)")).toBe("hello world test");
  });

  it("collapses whitespace", () => {
    expect(normalizeMemoryContent("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeMemoryContent("  hello  ")).toBe("hello");
  });
});

describe("Deduplicator", () => {
  describe("findDuplicate — exact normalized match", () => {
    it("detects duplicate with different casing", () => {
      const cand = candidate({ content: "USE STANDALONE COMPONENTS" });
      const existing = [entry({ content: "use standalone components" })];
      const result = deduplicator.findDuplicate(cand, existing);
      expect(result).toBeDefined();
      expect(result!.id).toBe("mem_1");
    });

    it("detects duplicate with different punctuation", () => {
      const cand = candidate({ content: "Use standalone components!" });
      const existing = [entry({ content: "Use standalone components." })];
      const result = deduplicator.findDuplicate(cand, existing);
      expect(result).toBeDefined();
    });
  });

  describe("findDuplicate — Jaccard threshold boundary", () => {
    it("returns undefined when Jaccard similarity is below 0.9 (8/9 = 0.889)", () => {
      const cand = candidate({
        content: "alpha bravo charlie delta echo foxtrot golf hotel india"
      });
      const existing = [
        entry({
          content: "alpha bravo charlie delta echo foxtrot golf hotel"
        })
      ];
      const result = deduplicator.findDuplicate(cand, existing);
      expect(result).toBeUndefined();
    });

    it("detects duplicate when Jaccard similarity equals 0.9 (9/10 = 0.9)", () => {
      const cand = candidate({
        content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet"
      });
      const existing = [
        entry({
          content: "alpha bravo charlie delta echo foxtrot golf hotel india"
        })
      ];
      const result = deduplicator.findDuplicate(cand, existing);
      expect(result).toBeDefined();
    });

    it("detects duplicate when Jaccard similarity exceeds 0.9 (10/11 = 0.909)", () => {
      const cand = candidate({
        content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo"
      });
      const existing = [
        entry({
          content: "alpha bravo charlie delta echo foxtrot golf hotel india juliet"
        })
      ];
      const result = deduplicator.findDuplicate(cand, existing);
      expect(result).toBeDefined();
    });
  });

  describe("findDuplicate — edge cases", () => {
    it("returns undefined for empty existing array", () => {
      const result = deduplicator.findDuplicate(candidate(), []);
      expect(result).toBeUndefined();
    });

    it("returns undefined for unique content", () => {
      const cand = candidate({ content: "This project deploys to Kubernetes." });
      const existing = [entry({ content: "PostgreSQL is the primary database." })];
      const result = deduplicator.findDuplicate(cand, existing);
      expect(result).toBeUndefined();
    });
  });

  describe("findDuplicate — cross-type deduplication", () => {
    it("detects duplicate when existing array contains candidates", () => {
      const cand = candidate({ content: "USE STANDALONE COMPONENTS" });
      const pendingCandidates = [candidate({ id: "cand_pending", content: "use standalone components" })];
      const result = deduplicator.findDuplicate(cand, pendingCandidates);
      expect(result).toBeDefined();
      expect(result!.id).toBe("cand_pending");
    });

    it("detects duplicate in mixed array of entries and candidates", () => {
      const cand = candidate({ content: "Use standalone components!" });
      const mixed = [
        entry({ id: "mem_1", content: "Something unrelated." }),
        candidate({ id: "cand_pending", content: "Use standalone components." })
      ];
      const result = deduplicator.findDuplicate(cand, mixed);
      expect(result).toBeDefined();
      expect(result!.id).toBe("cand_pending");
    });
  });
});
