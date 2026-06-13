import { describe, it, expect, vi } from "vitest";
import { createMemoryRoutes } from "../../../../apps/review-ui/src/routes/memories";
import type { MemoryStore } from "@openmembrane/core";
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
  const mockMemoryStore: MemoryStore = {
    list: vi.fn().mockResolvedValue([fakeMemory]),
    findById: vi.fn().mockResolvedValue(fakeMemory),
    save: vi.fn(),
    supersede: vi.fn().mockResolvedValue({ ...fakeMemory, status: "superseded" }),
    search: vi.fn().mockResolvedValue([fakeMemory]),
  };

  const routes = createMemoryRoutes("test", mockMemoryStore);

  it("listMemories returns all active memories", async () => {
    const result = await routes.listMemories(mockContext());
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect((result.body as unknown[]).length).toBe(1);
  });

  it("listMemories uses search when q param provided", async () => {
    const result = await routes.listMemories(mockContext({}, new URLSearchParams("q=ESM")));
    expect(result.status).toBe(200);
    expect(mockMemoryStore.search).toHaveBeenCalledWith("test", "ESM", {});
  });

  it("listMemories filters by type", async () => {
    const result = await routes.listMemories(mockContext({}, new URLSearchParams("type=coding_rule")));
    expect(result.status).toBe(200);
  });

  it("getMemory returns a memory by id", async () => {
    const result = await routes.getMemory(mockContext({ id: "mem_1" }));
    expect(result.status).toBe(200);
    expect((result.body as { id: string }).id).toBe("mem_1");
  });

  it("getMemory returns 404 for missing memory", async () => {
    (mockMemoryStore.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await routes.getMemory(mockContext({ id: "mem_999" }));
    expect(result.status).toBe(404);
  });

  it("supersedeMemory marks memory as superseded", async () => {
    const result = await routes.supersedeMemory(mockContext({ id: "mem_1" }));
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("superseded");
  });

  it("supersedeMemory returns 404 on error", async () => {
    (mockMemoryStore.supersede as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not found"));
    const result = await routes.supersedeMemory(mockContext({ id: "mem_999" }));
    expect(result.status).toBe(404);
  });
});
