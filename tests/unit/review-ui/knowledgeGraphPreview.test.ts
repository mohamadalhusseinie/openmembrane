import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("synthetic Knowledge Graph preview server", () => {
  it("returns 400 for malformed URL encoding and remains available", async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/knowledge-graph-preview.mjs", "0"],
      { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });

    let output = "";
    let port: number;
    try {
      port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Preview server did not start: ${stderr}`)), 10_000);
        child.stdout.on("data", chunk => {
          output += chunk.toString();
          const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
          if (!match) return;
          clearTimeout(timeout);
          resolve(Number(match[1]));
        });
        child.once("error", error => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", code => {
          clearTimeout(timeout);
          reject(new Error(`Preview server exited before startup (${code}): ${stderr}`));
        });
      });

      const baseUrl = `http://127.0.0.1:${port}`;
      const projectResponse = await fetch(`${baseUrl}/api/project`);
      expect(projectResponse.status).toBe(200);
      expect(await projectResponse.json()).toEqual({ projectId: "Synthetic preview", syntheticPreview: true });

      for (const path of ["/api/candidates", "/api/memories/stale", "/api/audit", "/api/diagnostics"]) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
      }

      const malformedResponse = await fetch(`${baseUrl}/api/graph/entities/%/anything`);
      expect(malformedResponse.status).toBe(400);
      expect(await malformedResponse.json()).toEqual({ error: "Invalid URL encoding." });

      const graphResponse = await fetch(`${baseUrl}/api/graph`);
      expect(graphResponse.status).toBe(200);
      const graph = await graphResponse.json() as { nodes: unknown[]; edges: unknown[] };
      expect(graph.nodes).toHaveLength(500);
      expect(graph.edges).toHaveLength(1000);
    } finally {
      if (child.exitCode === null) {
        const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
        child.kill();
        await exited;
      }
    }
  }, 20_000);
});
