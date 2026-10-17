import type { OpenMembraneClient } from "@openmembrane/client";
import { auditRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { projectFields, queryInput } from "./validation";

export function createAuditRoutes(project: Pick<OpenMembraneClient, "listAuditLog">) {
  return {
    async listAudit(ctx: RouteContext): Promise<RouteResponse> {
      const input = auditRequestSchema.omit(projectFields).parse(queryInput(ctx.query, ["limit"]));
      const events = await project.listAuditLog({ ...input, order: "append" });
      return { status: 200, body: events };
    },
  };
}
