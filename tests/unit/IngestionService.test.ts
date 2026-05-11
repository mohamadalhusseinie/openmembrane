import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  validateIngestionRequest,
  MAX_TRANSCRIPT_LENGTH,
  MAX_SUMMARY_LENGTH,
  mapPipelineResult,
  IngestionService,
  MemoryPipeline,
  MockMemoryExtractor,
  OpenMembrainError,
  type MemoryPipelineResult
} from "@openmembrain/core";
import { JsonAuditLogStore, JsonMemoryStore, JsonPendingCandidateStore } from "@openmembrain/storage";
import { candidate, entry } from "./helpers.js";

describe("validateIngestionRequest", () => {
  it("throws VALIDATION_ERROR when projectId is empty", () => {
    expect(() => validateIngestionRequest({ projectId: "", transcript: "t" })).toThrow(OpenMembrainError);
    try {
      validateIngestionRequest({ projectId: "", transcript: "t" });
    } catch (e) {
      expect((e as OpenMembrainError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("throws VALIDATION_ERROR when projectId is whitespace-only", () => {
    expect(() => validateIngestionRequest({ projectId: "   ", transcript: "t" })).toThrow(OpenMembrainError);
  });

  it("throws VALIDATION_ERROR when neither transcript nor summary is provided", () => {
    expect(() => validateIngestionRequest({ projectId: "p1" })).toThrow(OpenMembrainError);
    try {
      validateIngestionRequest({ projectId: "p1" });
    } catch (e) {
      expect((e as OpenMembrainError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("throws when transcript exceeds MAX_TRANSCRIPT_LENGTH", () => {
    expect(() =>
      validateIngestionRequest({ projectId: "p1", transcript: "x".repeat(MAX_TRANSCRIPT_LENGTH + 1) })
    ).toThrow(OpenMembrainError);
  });

  it("throws when summary exceeds MAX_SUMMARY_LENGTH", () => {
    expect(() =>
      validateIngestionRequest({ projectId: "p1", summary: "x".repeat(MAX_SUMMARY_LENGTH + 1) })
    ).toThrow(OpenMembrainError);
  });

  it("does not throw when transcript is provided", () => {
    expect(() => validateIngestionRequest({ projectId: "p1", transcript: "hello" })).not.toThrow();
  });

  it("does not throw when summary is provided", () => {
    expect(() => validateIngestionRequest({ projectId: "p1", summary: "hello" })).not.toThrow();
  });

  it("does not throw when both are provided", () => {
    expect(() => validateIngestionRequest({ projectId: "p1", transcript: "t", summary: "s" })).not.toThrow();
  });
});

describe("mapPipelineResult", () => {
  it("maps saved entries correctly", () => {
    const result: MemoryPipelineResult = {
      projectId: "project-a",
      candidates: [],
      saved: [entry({ id: "mem_1", type: "coding_rule", scope: "frontend", content: "Use tabs." })],
      pending: [],
      rejected: [],
      superseded: [],
      redactions: []
    };
    const mapped = mapPipelineResult(result);
    expect(mapped.saved).toEqual([{ id: "mem_1", type: "coding_rule", scope: "frontend", content: "Use tabs." }]);
  });

  it("maps pending candidates correctly", () => {
    const result: MemoryPipelineResult = {
      projectId: "project-a",
      candidates: [],
      saved: [],
      pending: [candidate({ id: "cand_2", recommendedAction: "ask_user", conflictWith: ["mem_5"] })],
      rejected: [],
      superseded: [],
      redactions: []
    };
    const mapped = mapPipelineResult(result);
    expect(mapped.pending).toEqual([{
      id: "cand_2", type: "coding_rule", scope: "frontend",
      content: "This project uses standalone components.",
      recommendedAction: "ask_user", conflictWith: ["mem_5"]
    }]);
  });

  it("maps rejected candidates correctly", () => {
    const result: MemoryPipelineResult = {
      projectId: "project-a",
      candidates: [],
      saved: [],
      pending: [],
      rejected: [candidate({ id: "cand_3", recommendedAction: "reject", rejectionReason: "duplicate", duplicateOf: "mem_1" })],
      superseded: [],
      redactions: []
    };
    const mapped = mapPipelineResult(result);
    expect(mapped.rejected).toEqual([{ id: "cand_3", type: "coding_rule", rejectionReason: "duplicate", duplicateOf: "mem_1" }]);
  });

  it("maps superseded entries correctly", () => {
    const result: MemoryPipelineResult = {
      projectId: "project-a",
      candidates: [],
      saved: [],
      pending: [],
      rejected: [],
      superseded: [entry({ id: "mem_2", supersededBy: "mem_3" })],
      redactions: []
    };
    const mapped = mapPipelineResult(result);
    expect(mapped.superseded).toEqual([{ id: "mem_2", supersededBy: "mem_3" }]);
  });

  it("calculates counts correctly", () => {
    const result: MemoryPipelineResult = {
      projectId: "project-a",
      candidates: [candidate()],
      saved: [entry()],
      pending: [candidate({ id: "cand_2", recommendedAction: "ask_user" })],
      rejected: [candidate({ id: "cand_3", recommendedAction: "reject" })],
      superseded: [entry({ id: "mem_2" })],
      redactions: [{ type: "aws_access_key", match: "AKIA...", start: 0, end: 20 }]
    };
    const mapped = mapPipelineResult(result);
    expect(mapped.savedCount).toBe(1);
    expect(mapped.pendingCount).toBe(1);
    expect(mapped.rejectedCount).toBe(1);
    expect(mapped.supersededCount).toBe(1);
    expect(mapped.redactionCount).toBe(1);
  });

  it("passes through projectId", () => {
    const result: MemoryPipelineResult = {
      projectId: "my-project",
      candidates: [], saved: [], pending: [], rejected: [], superseded: [], redactions: []
    };
    expect(mapPipelineResult(result).projectId).toBe("my-project");
  });

  it("omits optional fields when absent", () => {
    const result: MemoryPipelineResult = {
      projectId: "project-a",
      candidates: [],
      saved: [],
      pending: [candidate({ id: "cand_2", recommendedAction: "ask_user" })],
      rejected: [candidate({ id: "cand_3", recommendedAction: "reject" })],
      superseded: [entry({ id: "mem_2" })],
      redactions: []
    };
    const mapped = mapPipelineResult(result);
    expect(mapped.pending[0]).not.toHaveProperty("conflictWith");
    expect(mapped.rejected[0]).not.toHaveProperty("rejectionReason");
    expect(mapped.rejected[0]).not.toHaveProperty("duplicateOf");
    expect(mapped.superseded[0]).not.toHaveProperty("supersededBy");
  });
});

describe("IngestionService", () => {
  it("validates input before processing", async () => {
    const pipeline = {} as MemoryPipeline;
    const service = new IngestionService({ pipeline });
    await expect(service.ingest({ projectId: "p1" })).rejects.toThrow(OpenMembrainError);
  });

  describe("integration with MockMemoryExtractor", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "openmembrain-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("calls the pipeline and maps the result", async () => {
      const extractor = new MockMemoryExtractor();
      const memoryStore = new JsonMemoryStore(tempDir);
      const pendingCandidateStore = new JsonPendingCandidateStore(tempDir);
      const auditLogStore = new JsonAuditLogStore(tempDir);

      const pipeline = new MemoryPipeline({ extractor, memoryStore, pendingCandidateStore, auditLogStore });
      const service = new IngestionService({ pipeline });

      const result = await service.ingest({
        projectId: "project-a",
        transcript: "Use standalone components in the frontend."
      });

      expect(result.projectId).toBe("project-a");
      expect(typeof result.savedCount).toBe("number");
      expect(typeof result.pendingCount).toBe("number");
      expect(typeof result.rejectedCount).toBe("number");
      expect(typeof result.supersededCount).toBe("number");
      expect(typeof result.redactionCount).toBe("number");
      expect(result.savedCount + result.pendingCount + result.rejectedCount).toBeGreaterThanOrEqual(0);
    });
  });
});