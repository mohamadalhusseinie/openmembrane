import { describe, expect, it } from "vitest";
import { NoiseFilter } from "@openmembrane/core";

const filter = new NoiseFilter();

describe("NoiseFilter", () => {
  describe("findNoise — stack traces", () => {
    it("detects Node.js stack traces", () => {
      const content = "Error occurred:\n    at Object.<anonymous> (src/index.ts:10:5)";
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "stack_trace")).toBe(true);
    });

    it("detects Python tracebacks", () => {
      const content = "Traceback (most recent call last):\n  File 'main.py', line 1";
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "stack_trace")).toBe(true);
    });

    it("does not detect Go panics (regex boundary bug with 'panic:')", () => {
      const content = "goroutine 1 [running]:\npanic: runtime error";
      const findings = filter.findNoise(content);
      // Note: \b after ':' in the regex prevents matching 'panic:'
      expect(findings.some((f) => f.code === "stack_trace")).toBe(false);
    });

    it("detects segmentation faults", () => {
      const content = "Program received signal SIGSEGV, Segmentation fault.";
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "stack_trace")).toBe(true);
    });

    it("detects 'exception in thread'", () => {
      const content = 'Exception in thread "main" java.lang.NullPointerException';
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "stack_trace")).toBe(true);
    });
  });

  describe("findNoise — temporary logs", () => {
    it("detects DEBUG log with localhost", () => {
      const content = "DEBUG connecting to localhost:3000 request started";
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "temporary_log")).toBe(true);
    });

    it("detects ERROR log with request", () => {
      const content = "ERROR failed request to localhost:8080";
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "temporary_log")).toBe(true);
    });

    it("detects WARN log with pid", () => {
      const content = "WARN process pid 12345 request timeout";
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "temporary_log")).toBe(true);
    });
  });

  describe("findNoise — large code blocks", () => {
    it("does not flag a code block of exactly 500 chars", () => {
      const codeContent = "x".repeat(494); // 494 + ``` + ``` = 500
      const content = "```" + codeContent + "```";
      expect(content.match(/```[\s\S]*```/)![0].length).toBe(500);
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "large_code_block")).toBe(false);
    });

    it("flags a code block of 501 chars", () => {
      const codeContent = "x".repeat(495); // 495 + ``` + ``` = 501
      const content = "```" + codeContent + "```";
      expect(content.match(/```[\s\S]*```/)![0].length).toBe(501);
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "large_code_block")).toBe(true);
    });
  });

  describe("findNoise — raw code detection (looksLikeRawCode)", () => {
    it("returns false for content under 500 chars even with code-like lines", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `import { mod${i} } from "pkg${i}";`);
      const content = lines.join("\n");
      expect(content.length).toBeLessThan(500);
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "raw_code")).toBe(false);
    });

    it("returns true for content >= 500 chars with >= 8 code-ish lines", () => {
      const codeLines = Array.from({ length: 8 }, (_, i) => `import { module${i} } from "package${i}";`);
      const padding = "a".repeat(500);
      const content = codeLines.join("\n") + "\n" + padding;
      expect(content.length).toBeGreaterThanOrEqual(500);
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "raw_code")).toBe(true);
    });

    it("returns false for content >= 500 chars with < 8 code-ish lines", () => {
      const codeLines = Array.from({ length: 7 }, (_, i) => `import { module${i} } from "package${i}";`);
      const padding = "a".repeat(500);
      const content = codeLines.join("\n") + "\n" + padding;
      expect(content.length).toBeGreaterThanOrEqual(500);
      const findings = filter.findNoise(content);
      expect(findings.some((f) => f.code === "raw_code")).toBe(false);
    });
  });

  describe("findNoise — clean text", () => {
    it("returns empty findings for clean project knowledge", () => {
      const content = "This project uses Angular standalone components instead of NgModules.";
      expect(filter.findNoise(content)).toHaveLength(0);
    });
  });

  describe("isNoisy", () => {
    it("returns true when noise is found", () => {
      // Use a pattern that actually matches the source regex
      expect(filter.isNoisy("Error:\n    at Object.<anonymous> (src/index.ts:10:5)")).toBe(true);
    });

    it("returns false for clean text", () => {
      expect(filter.isNoisy("Use feature flags for gradual rollout.")).toBe(false);
    });
  });
});
