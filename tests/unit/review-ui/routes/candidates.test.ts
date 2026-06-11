import { describe, it, expect, vi } from "vitest";
import { createCandidateRoutes } from "../../../../apps/review-ui/src/routes/candidates";
import type { MemoryApprovalService, PendingCandidateStore } from "@openmembrain/core";
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
  const mockPendingStore: PendingCandidateStore = {
    list: vi.fn().mockResolvedValue([
      { id: "cand_1", projectId: "test", type: "coding_rule", content: "Test rule", scope: "global", confidence: "high", sensitivity: "internal", source: { kind: "session" }, reason: "detected", recommendedAction: "ask_user", tags: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    ]),
    findById: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  };

  const mockApprovalService = {
    approve: vi.fn().mockResolvedValue({ id: "mem_1", status: "active" }),
    reject: vi.fn().mockResolvedValue(undefined),
    approveAll: vi.fn().mockResolvedValue({ approved: [{ id: "mem_1" }], skipped: [] }),
    rejectAll: vi.fn().mockResolvedValue({ rejectedCount: 1 }),
  } as unknown as MemoryApprovalService;

  const routes = createCandidateRoutes("test", mockPendingStore, mockApprovalService);

  it("listCandidates returns pending candidates", async () => {
    const result = await routes.listCandidates(mockContext());
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect((result.body as unknown[]).length).toBe(1);
  });

  it("approveCandidate calls approval service", async () => {
    const result = await routes.approveCandidate(mockContext({ id: "cand_1" }));
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
    expect(mockApprovalService.approve).toHaveBeenCalledWith("test", "cand_1");
  });

  it("approveCandidate returns 400 on error", async () => {
    (mockApprovalService.approve as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Secret candidate"));
    const result = await routes.approveCandidate(mockContext({ id: "cand_secret" }));
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("Secret candidate");
  });

  it("rejectCandidate calls approval service with reason", async () => {
    const result = await routes.rejectCandidate(mockContext({ id: "cand_1" }, new URLSearchParams(), { reason: "Not relevant" }));
    expect(result.status).toBe(200);
    expect(mockApprovalService.reject).toHaveBeenCalledWith("test", "cand_1", "Not relevant");
  });

  it("approveAll returns count of approved", async () => {
    const result = await routes.approveAll(mockContext());
    expect(result.status).toBe(200);
    expect((result.body as { approved: number }).approved).toBe(1);
  });

  it("rejectAll returns count of rejected", async () => {
    const result = await routes.rejectAll(mockContext({}, new URLSearchParams(), { reason: "Cleanup" }));
    expect(result.status).toBe(200);
    expect((result.body as { rejected: number }).rejected).toBe(1);
  });
});
