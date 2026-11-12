import { describe, it, expect } from "vitest";
import { serveStatic } from "../../../apps/review-ui/src/static.js";
import { isAllowedReviewOrigin } from "../../../apps/review-ui/src/server.js";

describe("review UI origin validation", () => {
  it.each(["127.0.0.1", "localhost"])("accepts browser-normalized default-port requests for %s only on port 80", (host) => {
    expect(isAllowedReviewOrigin(host, undefined, 80)).toBe(true);
    expect(isAllowedReviewOrigin(host, `http://${host}`, 80)).toBe(true);
    expect(isAllowedReviewOrigin(`${host}:80`, `http://${host}`, 80)).toBe(true);
    expect(isAllowedReviewOrigin(host, `http://${host}`, 3000)).toBe(false);
    expect(isAllowedReviewOrigin(`${host}:3000`, `http://${host}:3000`, 3000)).toBe(true);
    expect(isAllowedReviewOrigin(`${host}:3000`, `http://${host}`, 3000)).toBe(false);
    expect(isAllowedReviewOrigin(host, "https://untrusted.example", 80)).toBe(false);
    expect(isAllowedReviewOrigin("untrusted.example", "http://untrusted.example", 80)).toBe(false);
  });
});

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

  it("serves the Knowledge Graph navigation, controls, and explorer module", async () => {
    const page = await serveStatic("/");
    const html = (page.body as Buffer).toString("utf-8");
    expect(html).toContain("Knowledge Graph");
    expect(html).toContain('id="graph-canvas"');
    expect(html).toContain('id="graph-focus"');
    expect(html).toContain('id="graph-list-toggle"');
    expect(html).toContain('src="/graph.js"');

    const script = await serveStatic("/graph.js");
    expect(script.status).toBe(200);
    expect(script.headers?.["Content-Type"]).toContain("javascript");
    expect((script.body as Buffer).toString("utf-8")).toContain("layoutGraphNodes");
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
