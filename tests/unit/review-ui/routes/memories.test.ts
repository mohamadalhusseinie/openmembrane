import { describe, it, expect, vi } from "vitest";
import { createMemoryRoutes } from "../../../../apps/review-ui/src/routes/memories";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockContext(params: Record<string, string> = {}, query = new URLSearchParams()) {
  return {
    params,
    query,
    body: undefined,
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
  };
}

const fakeMemory = {
  id: "mem_1",
  projectId: "test",
  type: "coding_rule" as const,
  content: "Use ESM",
  scope: "global" as const,
  confidence: "high" as const,
  sensitivity: "internal" as const,
  source: { kind: "manual" as const },
  reason: "test",
  tags: [],
  status: "active" as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("memory routes", () => {
  const mockProject = {
    listMemories: vi.fn().mockResolvedValue([fakeMemory]),
    getMemory: vi.fn().mockResolvedValue(fakeMemory),
    updateMemory: vi.fn().mockResolvedValue(fakeMemory),
    reviewStaleMemories: vi.fn().mockResolvedValue([fakeMemory]),
    supersedeMemory: vi.fn().mockResolvedValue({ ...fakeMemory, status: "superseded" }),
  };

  const routes = createMemoryRoutes(mockProject);

  it("listMemories returns all active memories", async () => {
    const result = await routes.listMemories(mockContext());
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect((result.body as unknown[]).length).toBe(1);
    expect(mockProject.listMemories).toHaveBeenCalledWith({});
  });

  it("listMemories passes q as the service search query", async () => {
    const result = await routes.listMemories(mockContext({}, new URLSearchParams("q=ESM")));
    expect(result.status).toBe(200);
    expect(mockProject.listMemories).toHaveBeenCalledWith({ query: "ESM" });
  });

  it("listMemories filters by type", async () => {
    const result = await routes.listMemories(mockContext({}, new URLSearchParams("type=coding_rule")));
    expect(result.status).toBe(200);
    expect(mockProject.listMemories).toHaveBeenCalledWith({ types: ["coding_rule"] });
  });

  it("validates filters before calling the daemon", async () => {
    await expect(routes.listMemories(mockContext({}, new URLSearchParams("type=invalid")))).rejects.toThrow();
  });

  it("getMemory returns a memory by id", async () => {
    const result = await routes.getMemory(mockContext({ id: "mem_1" }));
    expect(result.status).toBe(200);
    expect((result.body as { id: string }).id).toBe("mem_1");
    expect(mockProject.getMemory).toHaveBeenCalledWith({ memoryId: "mem_1" });
  });

  it("getMemory returns 404 for missing memory", async () => {
    mockProject.getMemory.mockResolvedValueOnce(null);
    const result = await routes.getMemory(mockContext({ id: "mem_999" }));
    expect(result.status).toBe(404);
  });

  it("supersedeMemory marks memory as superseded", async () => {
    const result = await routes.supersedeMemory(mockContext({ id: "mem_1" }));
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("superseded");
    expect(mockProject.supersedeMemory).toHaveBeenCalledWith({ memoryId: "mem_1" });
  });

  it("propagates daemon errors to the safe server envelope", async () => {
    mockProject.supersedeMemory.mockRejectedValueOnce(new Error("daemon failure"));
    await expect(routes.supersedeMemory(mockContext({ id: "mem_999" }))).rejects.toThrow("daemon failure");
  });

  it("does not misreport a GitHub Team failure as a missing memory", async () => {
    mockProject.supersedeMemory.mockRejectedValueOnce(new Error("GitHub unavailable"));
    await expect(routes.supersedeMemory(mockContext({ id: "mem_1" }))).rejects.toThrow("GitHub unavailable");
  });
});
