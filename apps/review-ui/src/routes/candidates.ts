import type { MemoryApprovalService, PendingCandidateStore } from "@openmembrain/core";
import type { RouteContext, RouteResponse } from "../router";

export interface CandidateRouteHandlers {
  listCandidates: (ctx: RouteContext) => Promise<RouteResponse>;
  approveCandidate: (ctx: RouteContext) => Promise<RouteResponse>;
  rejectCandidate: (ctx: RouteContext) => Promise<RouteResponse>;
  approveAll: (ctx: RouteContext) => Promise<RouteResponse>;
  rejectAll: (ctx: RouteContext) => Promise<RouteResponse>;
}

export function createCandidateRoutes(
  projectId: string,
  pendingStore: PendingCandidateStore,
  approvalService: MemoryApprovalService,
): CandidateRouteHandlers {
  return {
    async listCandidates(_ctx) {
      const candidates = await pendingStore.list(projectId);
      return { status: 200, body: candidates };
    },

    async approveCandidate(ctx) {
      try {
        const result = await approvalService.approve(projectId, ctx.params["id"]!);
        return { status: 200, body: { ok: true, memory: result } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Approval failed";
        return { status: 400, body: { error: message } };
      }
    },

    async rejectCandidate(ctx) {
      const reason = (ctx.body as { reason?: string } | undefined)?.reason;
      try {
        await approvalService.reject(projectId, ctx.params["id"]!, reason);
        return { status: 200, body: { ok: true } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Rejection failed";
        return { status: 400, body: { error: message } };
      }
    },

    async approveAll(_ctx) {
      const result = await approvalService.approveAll(projectId);
      return { status: 200, body: { approved: result.approved.length, skipped: result.skipped } };
    },

    async rejectAll(ctx) {
      const reason = (ctx.body as { reason?: string } | undefined)?.reason;
      const result = await approvalService.rejectAll(projectId, reason);
      return { status: 200, body: { rejected: result.rejectedCount } };
    },
  };
}
