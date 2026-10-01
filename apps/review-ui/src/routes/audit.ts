import type { ProjectService } from "@openmembrane/service";
import type { RouteContext, RouteResponse } from "../router";

export function createAuditRoutes(project: ProjectService) {
  return {
    async listAudit(ctx: RouteContext): Promise<RouteResponse> {
      const limitStr = ctx.query.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : 100;
      const events = await project.listReviewAuditLog(limit);
      return { status: 200, body: events };
    },
  };
}
