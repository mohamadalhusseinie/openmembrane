import { describe, expect, it } from "vitest";
import { ConflictDetector } from "@openmembrain/core";
import { candidate, entry } from "./helpers";

const detector = new ConflictDetector();

describe("ConflictDetector", () => {
  describe("findConflicts — negation polarity", () => {
    it("detects conflict when candidate and existing have opposing negation", () => {
      const cand = candidate({ content: "Use NgModules for all feature modules." });
      const existing = [entry({ content: "Do not use NgModules in this project." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
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
    });

    it("compares when candidate scope is global", () => {
      const cand = candidate({ content: "Use NgModules for this.", scope: "global" });
      const existing = [entry({ content: "Do not use NgModules for this.", scope: "backend" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
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
    });

    it("detects conflict when concise framework choices are replaced", () => {
      const cand = candidate({ content: "Use React." });
      const existing = [entry({ content: "Use Angular." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
    });

    it("detects conflict when replacement wording mentions the old framework", () => {
      const cand = candidate({ content: "Use Angular instead of React for frontend components." });
      const existing = [entry({ content: "Use React for frontend components." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
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
    });

    it("detects conflict when Node.js v-prefixed runtime versions are replaced", () => {
      const cand = candidate({ content: "Target Node.js v22 for backend services.", scope: "backend" });
      const existing = [entry({ content: "Target Node.js v18 for backend services.", scope: "backend" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
    });

    it("detects conflict when deployment targets are replaced", () => {
      const cand = candidate({ content: "Deploy to bare metal servers.", scope: "deployment" });
      const existing = [entry({ content: "Deploy with Docker containers.", scope: "deployment" })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(1);
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
    });

    it("returns no conflict for unrelated same-scope memories", () => {
      const cand = candidate({ content: "Use React for frontend components." });
      const existing = [entry({ content: "Frontend tests require mocked runtime config." })];
      const conflicts = detector.findConflicts(cand, existing);
      expect(conflicts).toHaveLength(0);
    });
  });
});
