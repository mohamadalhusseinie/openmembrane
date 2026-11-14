import type { OpenMembraneClient } from "@openmembrane/client";
import { createRelationshipRequestSchema, knowledgeGraphEntityRequestSchema, knowledgeGraphRequestSchema, removeRelationshipRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { projectFields, queryInput } from "./validation";

export function createGraphRoutes(client: Pick<OpenMembraneClient, "getKnowledgeGraph" | "getKnowledgeGraphEntity" | "createRelationship" | "removeRelationship">) {
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
    async createRelationship(ctx: RouteContext): Promise<RouteResponse> {
      const input = createRelationshipRequestSchema.omit(projectFields).parse(ctx.body);
      return { status: 200, body: await client.createRelationship(input) };
    },
    async removeRelationship(ctx: RouteContext): Promise<RouteResponse> {
      const input = removeRelationshipRequestSchema.omit(projectFields).parse(ctx.body);
      return { status: 200, body: await client.removeRelationship(input) };
    },
  };
}
