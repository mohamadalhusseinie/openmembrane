import type { OpenMembraneClient } from "@openmembrane/client";
import { rejectAllRequestSchema } from "@openmembrane/protocol";
import type { RouteContext, RouteResponse } from "../router";
import { projectFields, bodyObject } from "./validation";

export function createCandidateRoutes(client: Pick<OpenMembraneClient, "listMemoryCandidates" | "approveMemoryCandidate" | "rejectMemoryCandidate" | "approveAllCandidates" | "rejectAllCandidates">) {
  function rejectionInput(ctx: RouteContext) {
    return rejectAllRequestSchema.omit(projectFields).parse(bodyObject(ctx.body));
  }
  return {
    async listCandidates(_ctx: RouteContext): Promise<RouteResponse> {
      return { status: 200, body: await client.listMemoryCandidates({ limit: null }) };
    },
    async approveCandidate(ctx: RouteContext): Promise<RouteResponse> {
      const memory = await client.approveMemoryCandidate({ candidateId: ctx.params.id! });
      return { status: 200, body: { ok: true, memory } };
    },
    async rejectCandidate(ctx: RouteContext): Promise<RouteResponse> {
      await client.rejectMemoryCandidate({ ...rejectionInput(ctx), candidateId: ctx.params.id! });
      return { status: 200, body: { ok: true } };
    },
    async approveAll(_ctx: RouteContext): Promise<RouteResponse> {
      const result = await client.approveAllCandidates({});
      return { status: 200, body: { approved: result.approved.length, skipped: result.skipped } };
    },
    async rejectAll(ctx: RouteContext): Promise<RouteResponse> {
      const result = await client.rejectAllCandidates(rejectionInput(ctx));
      return { status: 200, body: { rejected: result.rejectedCount } };
    },
  };
}
