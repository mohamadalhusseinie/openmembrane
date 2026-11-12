import type { OpenMembraneClient } from "@openmembrane/client";
import { knowledgeGraphEntityRequestSchema, knowledgeGraphRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { projectFields, queryInput } from "./validation";

export function createGraphRoutes(client: Pick<OpenMembraneClient, "getKnowledgeGraph" | "getKnowledgeGraphEntity">) {
  return {
    async graph(ctx: RouteContext): Promise<RouteResponse> {
      const raw = queryInput(ctx.query, ["limit"]);
      delete raw.kind;
      delete raw.relationshipType;
      const input = knowledgeGraphRequestSchema.omit(projectFields).parse({
        ...raw,
        ...(ctx.query.getAll("kind").length > 0 ? { entityKinds: ctx.query.getAll("kind") } : {}),
        ...(ctx.query.getAll("relationshipType").length > 0 ? { relationshipTypes: ctx.query.getAll("relationshipType") } : {}),
      });
      return { status: 200, body: await client.getKnowledgeGraph(input) };
    },
    async entity(ctx: RouteContext): Promise<RouteResponse> {
      const input = knowledgeGraphEntityRequestSchema.omit(projectFields).parse({
        kind: ctx.params.kind,
        id: ctx.params.id,
      });
      return { status: 200, body: await client.getKnowledgeGraphEntity(input) };
    },
  };
}
