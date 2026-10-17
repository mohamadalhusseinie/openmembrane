import type { OpenMembraneClient } from "@openmembrane/client";
import { listMemoriesRequestSchema, staleMemoriesRequestSchema, supersedeMemoryRequestSchema, updateMemoryRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { bodyObject, projectFields, queryInput } from "./validation";

export function createMemoryRoutes(client: Pick<OpenMembraneClient, "listMemories" | "getMemory" | "updateMemory" | "supersedeMemory" | "reviewStaleMemories">) {
  return {
    async listMemories(ctx: RouteContext): Promise<RouteResponse> {
      const input = listMemoriesRequestSchema.omit(projectFields).parse({
        ...queryInput(ctx.query, ["limit"]),
        ...(ctx.query.has("q") ? { query: ctx.query.get("q") } : {}),
        ...(ctx.query.has("type") ? { types: [ctx.query.get("type")] } : {}),
        ...(ctx.query.has("scope") ? { scopes: [ctx.query.get("scope")] } : {}),
      });
      return { status: 200, body: await client.listMemories(input) };
    },
    async getMemory(ctx: RouteContext): Promise<RouteResponse> {
      const memory = await client.getMemory({ memoryId: ctx.params.id! });
      return memory === null
        ? { status: 404, body: { error: "Memory not found" } }
        : { status: 200, body: memory };
    },
    async updateMemory(ctx: RouteContext): Promise<RouteResponse> {
      const input = updateMemoryRequestSchema.omit(projectFields).parse({ ...bodyObject(ctx.body), memoryId: ctx.params.id });
      return { status: 200, body: await client.updateMemory(input) };
    },
    async supersedeMemory(ctx: RouteContext): Promise<RouteResponse> {
      const input = supersedeMemoryRequestSchema.omit(projectFields).parse({ ...bodyObject(ctx.body), memoryId: ctx.params.id });
      return { status: 200, body: await client.supersedeMemory(input) };
    },
    async staleMemories(ctx: RouteContext): Promise<RouteResponse> {
      const input = staleMemoriesRequestSchema.omit(projectFields).parse(queryInput(ctx.query, ["staleAfterMonths"]));
      return { status: 200, body: await client.reviewStaleMemories(input) };
    },
  };
}
