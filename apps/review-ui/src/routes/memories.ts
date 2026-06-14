import type { MemoryStore } from "@openmembrane/core";
import type { RouteContext, RouteResponse } from "../router";

export interface MemoryRouteHandlers {
  listMemories: (ctx: RouteContext) => Promise<RouteResponse>;
  getMemory: (ctx: RouteContext) => Promise<RouteResponse>;
  supersedeMemory: (ctx: RouteContext) => Promise<RouteResponse>;
}

export function createMemoryRoutes(projectId: string, memoryStore: MemoryStore): MemoryRouteHandlers {
  return {
    async listMemories(ctx) {
      const type = ctx.query.get("type") ?? undefined;
      const scope = ctx.query.get("scope") ?? undefined;
      const q = ctx.query.get("q") ?? undefined;
      const limitStr = ctx.query.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;

      if (q) {
        const results = await memoryStore.search(projectId, q, {
          ...(type ? { types: [type as never] } : {}),
          ...(scope ? { scopes: [scope as never] } : {}),
          ...(limit ? { limit } : {}),
        });
        return { status: 200, body: results };
      }

      const all = await memoryStore.list(projectId);
      let filtered = all.filter((m) => m.status === "active");
      if (type) filtered = filtered.filter((m) => m.type === type);
      if (scope) filtered = filtered.filter((m) => m.scope === scope);
      if (limit) filtered = filtered.slice(0, limit);
      return { status: 200, body: filtered };
    },

    async getMemory(ctx) {
      const memory = await memoryStore.findById(projectId, ctx.params["id"]!);
      if (!memory) {
        return { status: 404, body: { error: "Memory not found" } };
      }
      return { status: 200, body: memory };
    },

    async supersedeMemory(ctx) {
      try {
        const entry = await memoryStore.supersede(projectId, ctx.params["id"]!);
        return { status: 200, body: entry };
      } catch {
        return { status: 404, body: { error: "Memory not found" } };
      }
    },
  };
}
