import { OpenMembraneError } from "@openmembrane/core";
import type { MemoryScope, MemoryType } from "@openmembrane/core";
import type { ProjectService } from "@openmembrane/service";
import type { RouteContext, RouteResponse } from "../router";

export interface MemoryRouteHandlers {
  listMemories: (ctx: RouteContext) => Promise<RouteResponse>;
  getMemory: (ctx: RouteContext) => Promise<RouteResponse>;
  supersedeMemory: (ctx: RouteContext) => Promise<RouteResponse>;
}

export function createMemoryRoutes(project: ProjectService): MemoryRouteHandlers {
  return {
    async listMemories(ctx) {
      const type = ctx.query.get("type") ?? undefined;
      const scope = ctx.query.get("scope") ?? undefined;
      const q = ctx.query.get("q") ?? undefined;
      const limitStr = ctx.query.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;

      const memories = await project.listMemories({
        ...(q ? { query: q } : {}),
        ...(type ? { types: [type as MemoryType] } : {}),
        ...(scope ? { scopes: [scope as MemoryScope] } : {}),
        ...(limit ? { limit } : {}),
      });
      return { status: 200, body: memories.filter((memory) => memory.status === "active") };
    },

    async getMemory(ctx) {
      const memory = await project.getMemory(ctx.params["id"]!);
      if (!memory) {
        return { status: 404, body: { error: "Memory not found" } };
      }
      return { status: 200, body: memory };
    },

    async supersedeMemory(ctx) {
      try {
        const entry = await project.supersedeMemory({ memoryId: ctx.params["id"]! });
        return { status: 200, body: entry };
      } catch (error) {
        if (error instanceof OpenMembraneError && error.code === "MEMORY_NOT_FOUND") {
          return { status: 404, body: { error: "Memory not found" } };
        }
        throw error;
      }
    },
  };
}
