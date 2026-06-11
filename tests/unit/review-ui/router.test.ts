import { describe, it, expect } from "vitest";
import { Router } from "../../../apps/review-ui/src/router";

describe("Router", () => {
  it("matches exact paths", () => {
    const router = new Router();
    const handler = () => ({ status: 200, body: "ok" });
    router.get("/api/test", handler);

    const match = router.match("GET", "/api/test");
    expect(match).not.toBeUndefined();
    expect(match!.handler).toBe(handler);
    expect(match!.params).toEqual({});
  });

  it("matches parameterized paths", () => {
    const router = new Router();
    const handler = () => ({ status: 200, body: "ok" });
    router.get("/api/memories/:id", handler);

    const match = router.match("GET", "/api/memories/mem_123");
    expect(match).not.toBeUndefined();
    expect(match!.params).toEqual({ id: "mem_123" });
  });

  it("returns undefined for no match", () => {
    const router = new Router();
    router.get("/api/test", () => ({ status: 200, body: "ok" }));

    const match = router.match("POST", "/api/test");
    expect(match).toBeUndefined();
  });

  it("registers POST routes", () => {
    const router = new Router();
    const handler = () => ({ status: 200, body: "ok" });
    router.post("/api/candidates/:id/approve", handler);

    const match = router.match("POST", "/api/candidates/cand_456/approve");
    expect(match).not.toBeUndefined();
    expect(match!.params).toEqual({ id: "cand_456" });
  });

  it("does not match different path lengths", () => {
    const router = new Router();
    router.get("/api/memories", () => ({ status: 200, body: "ok" }));

    const match = router.match("GET", "/api/memories/extra");
    expect(match).toBeUndefined();
  });
});
