import type { AuditLogStore } from "@openmembrain/core";
import type { RouteContext, RouteResponse } from "../router";

export function createAuditRoutes(projectId: string, auditStore: AuditLogStore) {
  return {
    async listAudit(ctx: RouteContext): Promise<RouteResponse> {
      const events = await auditStore.list(projectId);
      const limitStr = ctx.query.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : 100;
      const limited = events.slice(-limit).reverse();
      return { status: 200, body: limited };
    },
  };
}
