import { describe, it, expect, vi } from "vitest";
import { createCandidateRoutes } from "../../../../apps/review-ui/src/routes/candidates";
import type { ProjectService } from "@openmembrane/service";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockContext(params: Record<string, string> = {}, query = new URLSearchParams(), body: unknown = undefined) {
  return {
    params,
    query,
    body,
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
  };
}

describe("candidate routes", () => {
  const mockProject = {
    listCandidates: vi.fn().mockResolvedValue([
      { id: "cand_1", projectId: "test", type: "coding_rule", content: "Test rule", scope: "global", confidence: "high", sensitivity: "internal", source: { kind: "session" }, reason: "detected", recommendedAction: "ask_user", tags: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    ]),
    approveCandidate: vi.fn().mockResolvedValue({ id: "mem_1", status: "active" }),
    rejectCandidate: vi.fn().mockResolvedValue(undefined),
    approveAllCandidates: vi.fn().mockResolvedValue({ approved: [{ id: "mem_1" }], skipped: [] }),
    rejectAllCandidates: vi.fn().mockResolvedValue({ rejectedCount: 1 }),
  };

  const routes = createCandidateRoutes(mockProject as unknown as ProjectService);

  it("listCandidates returns pending candidates", async () => {
    const result = await routes.listCandidates(mockContext());
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect((result.body as unknown[]).length).toBe(1);
    expect(mockProject.listCandidates).toHaveBeenCalledWith({ limit: Number.MAX_SAFE_INTEGER });
  });

  it("approveCandidate calls approval service", async () => {
    const result = await routes.approveCandidate(mockContext({ id: "cand_1" }));
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
    expect(mockProject.approveCandidate).toHaveBeenCalledWith({ candidateId: "cand_1" });
  });

  it("approveCandidate returns 400 on error", async () => {
    mockProject.approveCandidate.mockRejectedValueOnce(new Error("Secret candidate"));
    const result = await routes.approveCandidate(mockContext({ id: "cand_secret" }));
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("Secret candidate");
  });

  it("rejectCandidate calls approval service with reason", async () => {
    const result = await routes.rejectCandidate(mockContext({ id: "cand_1" }, new URLSearchParams(), { reason: "Not relevant" }));
    expect(result.status).toBe(200);
    expect(mockProject.rejectCandidate).toHaveBeenCalledWith({ candidateId: "cand_1", reason: "Not relevant" });
  });

  it("approveAll returns count of approved", async () => {
    const result = await routes.approveAll(mockContext());
    expect(result.status).toBe(200);
    expect((result.body as { approved: number }).approved).toBe(1);
    expect(mockProject.approveAllCandidates).toHaveBeenCalledWith({});
  });

  it("rejectAll returns count of rejected", async () => {
    const result = await routes.rejectAll(mockContext({}, new URLSearchParams(), { reason: "Cleanup" }));
    expect(result.status).toBe(200);
    expect((result.body as { rejected: number }).rejected).toBe(1);
    expect(mockProject.rejectAllCandidates).toHaveBeenCalledWith({ reason: "Cleanup" });
  });
});
