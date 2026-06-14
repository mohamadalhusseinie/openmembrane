import type { DiagnosticsLogStore } from "@openmembrane/core";
import type { RouteContext, RouteResponse } from "../router";

export function createDiagnosticsRoutes(projectId: string, diagnosticsStore: DiagnosticsLogStore) {
  return {
    async listDiagnostics(ctx: RouteContext): Promise<RouteResponse> {
      const severity = ctx.query.get("severity") ?? undefined;
      const code = ctx.query.get("code") ?? undefined;
      const limitStr = ctx.query.get("limit");
      const limit = limitStr ? parseInt(limitStr, 10) : 100;

      const events = await diagnosticsStore.list(projectId, {
        ...(severity ? { severity: severity as "debug" | "info" | "warning" | "error" } : {}),
        ...(code ? { code } : {}),
        ...(limit ? { limit } : {}),
      });
      return { status: 200, body: events.reverse() };
    },
  };
}
