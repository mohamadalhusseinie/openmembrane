import type { OpenMembraneClient } from "@openmembrane/client";
import { diagnosticsRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { projectFields, queryInput } from "./validation";

export function createDiagnosticsRoutes(project: Pick<OpenMembraneClient, "getDiagnostics">) {
  return {
    async listDiagnostics(ctx: RouteContext): Promise<RouteResponse> {
      const input = diagnosticsRequestSchema.omit(projectFields).parse(queryInput(ctx.query, ["limit"]));
      const events = await project.getDiagnostics(input);
      return { status: 200, body: events.reverse() };
    },
  };
}
