import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SessionIngestor } from "@openmembrain/core";

const ingestor = new SessionIngestor();

describe("SessionIngestor", () => {
  describe("ingest — transcript redaction", () => {
    it("redacts secrets from transcript", () => {
      const result = ingestor.ingest({
        projectId: "project-a",
        transcript: "The API key is AKIAIOSFODNN7EXAMPLE."
      });
      expect(result.input.transcript).toContain("[REDACTED:aws_access_key]");
      expect(result.input.transcript).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.redactions).toHaveLength(1);
    });
  });

  describe("ingest — summary redaction", () => {
    it("redacts secrets from summary", () => {
      const result = ingestor.ingest({
        projectId: "project-a",
        summary: "Database at postgresql://user:pass@host:5432/db"
      });
      expect(result.input.summary).toContain("[REDACTED:database_url]");
      expect(result.input.summary).not.toContain("postgresql://");
      expect(result.redactions).toHaveLength(1);
    });
  });

  describe("ingest — both fields redacted", () => {
    it("redacts secrets from both transcript and summary", () => {
      const result = ingestor.ingest({
        projectId: "project-a",
        transcript: "Key: AKIAIOSFODNN7EXAMPLE",
        summary: "Uses postgresql://user:pass@host/db"
      });
      expect(result.input.transcript).toContain("[REDACTED:");
      expect(result.input.summary).toContain("[REDACTED:");
      expect(result.redactions).toHaveLength(2);
    });
  });

  describe("ingest — clean text", () => {
    it("preserves clean text unchanged", () => {
      const result = ingestor.ingest({
        projectId: "project-a",
        transcript: "Use standalone components.",
        summary: "Angular project setup."
      });
      expect(result.input.transcript).toBe("Use standalone components.");
      expect(result.input.summary).toBe("Angular project setup.");
      expect(result.redactions).toHaveLength(0);
    });
  });

  describe("ingest — createdAt default", () => {
    it("defaults createdAt to current time when not provided", () => {
      const result = ingestor.ingest({
        projectId: "project-a",
        transcript: "Some text."
      });
      expect(result.input.createdAt).toBeDefined();
      expect(result.input.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("preserves provided createdAt", () => {
      const result = ingestor.ingest({
        projectId: "project-a",
        transcript: "Some text.",
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      expect(result.input.createdAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("ingest — transcriptHash", () => {
    it("computes SHA-256 of raw (pre-redaction) text", () => {
      const rawTranscript = "Key: AKIAIOSFODNN7EXAMPLE";
      const result = ingestor.ingest({
        projectId: "project-a",
        transcript: rawTranscript
      });
      const expected = createHash("sha256").update(rawTranscript).digest("hex");
      expect(result.transcriptHash).toBe(expected);
    });

    it("hashes combined summary and transcript", () => {
      const summary = "Project summary.";
      const transcript = "Session transcript.";
      const result = ingestor.ingest({
        projectId: "project-a",
        summary,
        transcript
      });
      const expected = createHash("sha256").update(`${summary}\n\n${transcript}`).digest("hex");
      expect(result.transcriptHash).toBe(expected);
    });

    it("returns undefined transcriptHash when no text provided", () => {
      const result = ingestor.ingest({ projectId: "project-a" });
      expect(result.transcriptHash).toBeUndefined();
    });
  });
});
