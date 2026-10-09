import type { ProjectService } from "@openmembrane/service";
import type { RouteContext, RouteResponse } from "../router";

export interface CandidateRouteHandlers {
  listCandidates: (ctx: RouteContext) => Promise<RouteResponse>;
  approveCandidate: (ctx: RouteContext) => Promise<RouteResponse>;
  rejectCandidate: (ctx: RouteContext) => Promise<RouteResponse>;
  approveAll: (ctx: RouteContext) => Promise<RouteResponse>;
  rejectAll: (ctx: RouteContext) => Promise<RouteResponse>;
}

export function createCandidateRoutes(project: ProjectService): CandidateRouteHandlers {
  return {
    async listCandidates(_ctx) {
      const candidates = await project.listCandidates({ limit: Number.MAX_SAFE_INTEGER });
      return { status: 200, body: candidates };
    },

    async approveCandidate(ctx) {
      try {
        const result = await project.approveCandidate({ candidateId: ctx.params["id"]! });
        return { status: 200, body: { ok: true, memory: result } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Approval failed";
        return { status: 400, body: { error: message } };
      }
    },

    async rejectCandidate(ctx) {
      const reason = (ctx.body as { reason?: string } | undefined)?.reason;
      try {
        await project.rejectCandidate({ candidateId: ctx.params["id"]!, ...(reason !== undefined ? { reason } : {}) });
        return { status: 200, body: { ok: true } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Rejection failed";
        return { status: 400, body: { error: message } };
      }
    },

    async approveAll(_ctx) {
      const result = await project.approveAllCandidates({});
      return { status: 200, body: { approved: result.approved.length, skipped: result.skipped } };
    },

    async rejectAll(ctx) {
      const reason = (ctx.body as { reason?: string } | undefined)?.reason;
      const result = await project.rejectAllCandidates(reason !== undefined ? { reason } : {});
      return { status: 200, body: { rejected: result.rejectedCount } };
    },
  };
}
