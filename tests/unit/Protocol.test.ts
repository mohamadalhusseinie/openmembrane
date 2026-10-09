import { describe, expect, it } from "vitest";
import {
  absolutePathSchema, collaborationStatusResponseSchema, endpoints, errorResponseSchema,
  ingestRequestSchema, memoryMutationResponseSchema, rememberRequestSchema, resolveDaemonPaths,
} from "@openmembrane/protocol";
import type { EndpointName } from "@openmembrane/protocol";
import { entry } from "./helpers";
import { projectRoot, protocolFixtures } from "./protocolFixtures";

describe("v1 protocol", () => {
  it("defines all 19 endpoints with unique methods and versioned paths", () => {
    expect(Object.keys(endpoints)).toHaveLength(19);
    const routes = Object.values(endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(routes).size).toBe(19);
    for (const endpoint of Object.values(endpoints)) expect(endpoint.path).toMatch(/^\/v1\//);
  });

  for (const name of Object.keys(endpoints) as EndpointName[]) {
    it(`round-trips the ${name} request and response without losing fields`, () => {
      const fixture = protocolFixtures[name];
      expect(endpoints[name].request.parse(JSON.parse(JSON.stringify(fixture.request)))).toEqual(fixture.request);
      expect(endpoints[name].response.parse(JSON.parse(JSON.stringify(fixture.response)))).toEqual(fixture.response);
      if (endpoints[name].projectScoped) {
        expect(endpoints[name].request.safeParse({ ...fixture.request, projectRoot: "relative" }).success).toBe(false);
        expect(endpoints[name].request.safeParse({ ...fixture.request, storageBackend: "unknown" }).success).toBe(false);
      }
    });
  }

  it("validates required inputs and existing MCP bounds", () => {
    expect(absolutePathSchema.safeParse("relative").success).toBe(false);
    expect(rememberRequestSchema.safeParse({ projectRoot }).success).toBe(false);
    expect(rememberRequestSchema.safeParse({ projectRoot, items: [] }).success).toBe(false);
    expect(rememberRequestSchema.safeParse({ projectRoot, content: "Too short", type: "coding_rule" }).success).toBe(false);
    expect(rememberRequestSchema.safeParse({ projectRoot, content: "Use standalone components.", type: "coding_rule" }).success).toBe(true);
    expect(ingestRequestSchema.safeParse({ projectRoot }).success).toBe(false);
    expect(ingestRequestSchema.safeParse({ projectRoot, transcript: "x".repeat(100_001) }).success).toBe(false);
    expect(ingestRequestSchema.safeParse({ projectRoot, summary: "x".repeat(10_001) }).success).toBe(false);
    expect(endpoints.getRelevantContext.request.safeParse({ projectRoot, query: "x", limit: 51 }).success).toBe(false);
    expect(endpoints.getDiagnostics.request.safeParse({ projectRoot, limit: 501 }).success).toBe(false);
    expect(endpoints.health.response.safeParse({ projectRoot }).success).toBe(false);
  });

  it("does not silently discard malformed publication responses", () => {
    expect(memoryMutationResponseSchema.safeParse({ ...entry(), kind: "published" }).success).toBe(false);
    expect(memoryMutationResponseSchema.safeParse({ ...entry(), kind: "retry_scheduled", code: "wrong" }).success).toBe(false);
    expect(memoryMutationResponseSchema.safeParse({ ...entry(), sensitivity: "secret" }).success).toBe(false);
  });

  it("round-trips safe errors and local collaboration status", () => {
    const error = { error: { code: "VALIDATION_ERROR", safeMessage: "Invalid request.", diagnosticId: "diag_1" } };
    expect(errorResponseSchema.parse(JSON.parse(JSON.stringify(error)))).toEqual(error);
    expect(errorResponseSchema.safeParse({ error: { code: "INVALID", safeMessage: "Invalid" } }).success).toBe(false);
    const local = { mode: "local_private", proposals: { proposed: 0, active: 0, rejected: 0, syncFailed: 0, conflict: 0 }, retries: [] };
    expect(collaborationStatusResponseSchema.parse(local)).toEqual(local);
    expect(endpoints.configureGitHubTeamMode.response.parse({ kind: "rejected", code: "GITHUB_AUTH_REQUIRED", message: "Authenticate." })).toEqual({ kind: "rejected", code: "GITHUB_AUTH_REQUIRED", message: "Authenticate." });
  });
});

describe("shared per-user daemon paths", () => {
  it("uses XDG_RUNTIME_DIR on Unix and the home fallback otherwise", () => {
    const xdg = resolveDaemonPaths({ platform: "linux", homeDir: "/home/alice", runtimeDir: "/run/user/1000" });
    expect(xdg.runDir).toBe("/run/user/1000/openmembrane");
    expect(xdg.socketPath).toBe("/run/user/1000/openmembrane/daemon.sock");
    expect(xdg.tokenPath).toBe("/run/user/1000/openmembrane/token");
    expect(resolveDaemonPaths({ platform: "darwin", homeDir: "/Users/alice", runtimeDir: "" }).runDir).toBe("/Users/alice/.openmembrane/run");
  });

  it("ignores XDG on Windows and uses Windows path semantics", () => {
    const paths = resolveDaemonPaths({ platform: "win32", homeDir: "C:\\Users\\alice", runtimeDir: "/run/user/1000" });
    expect(paths.runDir).toBe("C:\\Users\\alice\\.openmembrane\\run");
    expect(paths.endpointPath).toBe("C:\\Users\\alice\\.openmembrane\\run\\endpoint.json");
    expect(() => resolveDaemonPaths({ platform: "linux", homeDir: "/home/alice", runtimeDir: "relative" })).toThrow("absolute");
  });
});
