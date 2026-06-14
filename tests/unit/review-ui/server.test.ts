import { describe, it, expect } from "vitest";
import { serveStatic } from "../../../apps/review-ui/src/static.js";

describe("review-ui static file serving", () => {
  it("serves index.html at /", async () => {
    const result = await serveStatic("/");
    expect(result.status).toBe(200);
    expect(result.headers?.["Content-Type"]).toContain("text/html");
    expect(result.body).toBeInstanceOf(Buffer);
  });

  it("serves index.html content that includes OpenMembrane", async () => {
    const result = await serveStatic("/");
    expect(result.status).toBe(200);
    const content = (result.body as Buffer).toString("utf-8");
    expect(content).toContain("OpenMembrane");
  });

  it("returns 404 for nonexistent files", async () => {
    const result = await serveStatic("/nonexistent.xyz");
    expect(result.status).toBe(404);
  });

  it("blocks directory traversal with ..", async () => {
    const result = await serveStatic("/../../../etc/passwd");
    expect(result.status).toBe(403);
  });

  it("returns correct MIME type for .html", async () => {
    const result = await serveStatic("/index.html");
    expect(result.status).toBe(200);
    expect(result.headers?.["Content-Type"]).toBe("text/html; charset=utf-8");
  });
});
