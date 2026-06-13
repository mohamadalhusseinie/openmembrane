import { describe, expect, it } from "vitest";
import { ConflictDetector } from "@openmembrane/core";
import { candidate, entry } from "./helpers";

const detector = new ConflictDetector();

describe("ConflictDetector", () => {
  describe("findConflicts — negation polarity", () => {
    it("detects conflict when candidate and existing have opposing negation", () => {
      const cand = candidate({ content: "Use NgModules for all feature modules." });
      const existing = [entry({ content: "Do not use NgModules in this project." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("negation");
    });

    it("returns no conflict when both have same negation (both negated)", () => {
      const cand = candidate({ content: "Never use console.log in production code." });
      const existing = [entry({ content: "Avoid console.log in production builds." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });

    it("returns no conflict when neither has negation (same polarity)", () => {
      const cand = candidate({ content: "Use Angular standalone components everywhere." });
      const existing = [entry({ content: "Use Angular standalone components for all features." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("findConflicts — token overlap threshold", () => {
    it("returns no conflict when token overlap is below 0.45", () => {
      const cand = candidate({
        content: "Angular components should follow single responsibility pattern."
      });
      const existing = [
        entry({
          content: "Do not create Angular modules with multiple backend services and routes."
        })
      ];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });

    it("detects conflict when token overlap is above 0.45 with opposing negation", () => {
      const cand = candidate({ content: "Use NgModules for feature organization." });
      const existing = [entry({ content: "Do not use NgModules for feature organization." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("negation");
    });
  });

  describe("findConflicts — scope filtering", () => {
    it("skips memories with different non-global scopes", () => {
      const cand = candidate({ content: "Use NgModules for this.", scope: "frontend" });
      const existing = [entry({ content: "Do not use NgModules for this.", scope: "backend" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });

    it("compares when existing memory scope is global", () => {
      const cand = candidate({ content: "Use NgModules for this.", scope: "frontend" });
      const existing = [entry({ content: "Do not use NgModules for this.", scope: "global" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("negation");
    });

    it("compares when candidate scope is global", () => {
      const cand = candidate({ content: "Use NgModules for this.", scope: "global" });
      const existing = [entry({ content: "Do not use NgModules for this.", scope: "backend" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("negation");
    });
  });

  describe("findConflicts — project filtering", () => {
    it("skips memories from different projects", () => {
      const cand = candidate({ content: "Use NgModules for this.", projectId: "project-a" });
      const existing = [entry({ content: "Do not use NgModules for this.", projectId: "project-b" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("findConflicts — empty/stop-word-only tokens", () => {
    it("returns no conflict when content produces no important tokens", () => {
      const cand = candidate({ content: "the use for and not this that" });
      const existing = [entry({ content: "do not use the for and" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("findConflicts — alternative choices", () => {
    it("detects conflict when framework choices are replaced", () => {
      const cand = candidate({ content: "Use React for frontend components." });
      const existing = [entry({ content: "Use Angular for frontend components." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("alternative");
    });

    it("detects conflict when concise framework choices are replaced", () => {
      const cand = candidate({ content: "Use React." });
      const existing = [entry({ content: "Use Angular." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("alternative");
    });

    it("detects conflict when replacement wording mentions the old framework", () => {
      const cand = candidate({ content: "Use Angular instead of React for frontend components." });
      const existing = [entry({ content: "Use React for frontend components." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("alternative");
    });

    it("returns no conflict when negated alternatives are compatible", () => {
      const cand = candidate({ content: "Do not use Angular for frontend components." });
      const existing = [entry({ content: "Use React for frontend components." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });

    it("detects conflict when runtime versions are replaced", () => {
      const cand = candidate({ content: "Target Node 22 for backend services.", scope: "backend" });
      const existing = [entry({ content: "Target Node 18 for backend services.", scope: "backend" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("version_mismatch");
    });

    it("detects conflict when Node.js v-prefixed runtime versions are replaced", () => {
      const cand = candidate({ content: "Target Node.js v22 for backend services.", scope: "backend" });
      const existing = [entry({ content: "Target Node.js v18 for backend services.", scope: "backend" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("version_mismatch");
    });

    it("detects conflict when deployment targets are replaced", () => {
      const cand = candidate({ content: "Deploy to bare metal servers.", scope: "deployment" });
      const existing = [entry({ content: "Deploy with Docker containers.", scope: "deployment" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("alternative");
    });

    it("returns no conflict when deployment wording uses compatible container terms", () => {
      const cand = candidate({ content: "Deploy with containers.", scope: "deployment" });
      const existing = [entry({ content: "Deploy with Docker.", scope: "deployment" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });

    it("detects conflict when indentation style is replaced", () => {
      const cand = candidate({ content: "Always use tabs for indentation in TypeScript files." });
      const existing = [entry({ content: "Always use spaces for indentation in TypeScript files." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.kind).toBe("alternative");
    });

    it("returns no conflict for unrelated same-scope memories", () => {
      const cand = candidate({ content: "Use React for frontend components." });
      const existing = [entry({ content: "Frontend tests require mocked runtime config." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("findConflictsAmong — entry-vs-entry", () => {
    it("returns empty map when no conflicts exist", () => {
      const entries = [
        entry({ id: "mem_1", content: "Use React for frontend components." }),
        entry({ id: "mem_2", content: "Frontend tests require mocked runtime config." }),
      ];
      const result = detector.findConflictsAmong(entries);
      expect(result.size).toBe(0);
    });

    it("detects negation conflict between two entries", () => {
      const entries = [
        entry({ id: "mem_1", content: "Use NgModules for all feature modules." }),
        entry({ id: "mem_2", content: "Do not use NgModules in this project." }),
      ];
      const result = detector.findConflictsAmong(entries);
      expect(result.size).toBe(2);

      const mem1Conflicts = result.get("mem_1")!;
      expect(mem1Conflicts).toHaveLength(1);
      expect(mem1Conflicts[0]!.memoryId).toBe("mem_2");
      expect(mem1Conflicts[0]!.kind).toBe("negation");

      const mem2Conflicts = result.get("mem_2")!;
      expect(mem2Conflicts).toHaveLength(1);
      expect(mem2Conflicts[0]!.memoryId).toBe("mem_1");
      expect(mem2Conflicts[0]!.kind).toBe("negation");
    });

    it("detects alternative conflict between two entries", () => {
      const entries = [
        entry({ id: "mem_1", content: "Use React for frontend components." }),
        entry({ id: "mem_2", content: "Use Angular for frontend components." }),
      ];
      const result = detector.findConflictsAmong(entries);
      expect(result.size).toBe(2);
      expect(result.get("mem_1")![0]!.kind).toBe("alternative");
      expect(result.get("mem_2")![0]!.kind).toBe("alternative");
    });

    it("detects version mismatch between two entries", () => {
      const entries = [
        entry({ id: "mem_1", content: "Target Node 22 for backend services.", scope: "backend" }),
        entry({ id: "mem_2", content: "Target Node 18 for backend services.", scope: "backend" }),
      ];
      const result = detector.findConflictsAmong(entries);
      expect(result.size).toBe(2);
      expect(result.get("mem_1")![0]!.kind).toBe("version_mismatch");
      expect(result.get("mem_2")![0]!.kind).toBe("version_mismatch");
    });

    it("returns empty map for a single entry", () => {
      const entries = [
        entry({ id: "mem_1", content: "Use React for frontend components." }),
      ];
      const result = detector.findConflictsAmong(entries);
      expect(result.size).toBe(0);
    });

    it("returns empty map for an empty array", () => {
      const result = detector.findConflictsAmong([]);
      expect(result.size).toBe(0);
    });

    it("skips pairs with different non-global scopes", () => {
      const entries = [
        entry({ id: "mem_1", content: "Use NgModules for this.", scope: "frontend" }),
        entry({ id: "mem_2", content: "Do not use NgModules for this.", scope: "backend" }),
      ];
      const result = detector.findConflictsAmong(entries);
      expect(result.size).toBe(0);
    });

    it("detects conflicts across multiple pairs", () => {
      const entries = [
        entry({ id: "mem_1", content: "Use pnpm for package management." }),
        entry({ id: "mem_2", content: "Use yarn for package management." }),
        entry({ id: "mem_3", content: "Use npm for package management." }),
      ];
      const result = detector.findConflictsAmong(entries);

      // Each entry conflicts with the other two
      expect(result.get("mem_1")).toHaveLength(2);
      expect(result.get("mem_2")).toHaveLength(2);
      expect(result.get("mem_3")).toHaveLength(2);
    });
  });
});
