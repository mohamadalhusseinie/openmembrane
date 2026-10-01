import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProjectService } from "@openmembrane/service";
import { createAuditRoutes } from "../../../../apps/review-ui/src/routes/audit";
import { createDiagnosticsRoutes } from "../../../../apps/review-ui/src/routes/diagnostics";

function mockContext(query = new URLSearchParams()) {
  return {
    params: {},
    query,
    body: undefined,
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
  };
}

describe("review UI history routes", () => {
  it("gets the most recent audit entries through the service", async () => {
    const events = [{ id: "audit_new" }, { id: "audit_old" }];
    const listReviewAuditLog = vi.fn().mockResolvedValue(events);
    const routes = createAuditRoutes({ listReviewAuditLog } as unknown as ProjectService);

    expect((await routes.listAudit(mockContext(new URLSearchParams("limit=2")))).body).toEqual(events);
    expect(listReviewAuditLog).toHaveBeenCalledWith(2);
  });

  it("preserves diagnostics filtering and response order", async () => {
    const events = [{ id: "new" }, { id: "old" }];
    const getDiagnostics = vi.fn().mockResolvedValue(events);
    const routes = createDiagnosticsRoutes({ getDiagnostics } as unknown as ProjectService);

    const result = await routes.listDiagnostics(mockContext(new URLSearchParams("severity=warning&code=EXTRACTION_PROVIDER_ERROR&limit=2")));
    expect(result.body).toEqual([{ id: "old" }, { id: "new" }]);
    expect(getDiagnostics).toHaveBeenCalledWith({ severity: "warning", code: "EXTRACTION_PROVIDER_ERROR", limit: 2 });
  });
});
