import type { OpenMembraneClient } from "@openmembrane/client";
import { exportRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { bodyObject, projectFields } from "./validation";

export function createExportRoutes(client: Pick<OpenMembraneClient, "exportStaticMemoryFiles">) {
  return {
    async preview(ctx: RouteContext): Promise<RouteResponse> {
      const input = exportRequestSchema.omit(projectFields).parse(bodyObject(ctx.body));
      return { status: 200, body: await client.exportStaticMemoryFiles({ ...input, preview: true }) };
    },
    async write(ctx: RouteContext): Promise<RouteResponse> {
      const input = exportRequestSchema.omit(projectFields).parse(bodyObject(ctx.body));
      return { status: 200, body: await client.exportStaticMemoryFiles({ ...input, preview: false }) };
    },
  };
}
