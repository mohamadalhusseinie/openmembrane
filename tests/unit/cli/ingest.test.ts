import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenMembraneClient, OpenMembraneClientError } from "@openmembrane/client";
import { runIngest } from "../../../apps/mcp-server/src/cli/ingest";
import { ingestion } from "../protocolFixtures";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("ingest completion and pending reminder", () => {
  it("warns explicitly if only the post-ingest reminder fails", async () => {
    vi.mocked(readFile).mockResolvedValue("rule: This project must use strict TypeScript settings.");
    vi.spyOn(OpenMembraneClient.prototype, "ingest").mockResolvedValue(ingestion);
    vi.spyOn(OpenMembraneClient.prototype, "listMemoryCandidates").mockRejectedValue(
      new OpenMembraneClientError("E_DAEMON_NOT_RUNNING", "The daemon is not running.", { diagnosticId: "diag_reminder" }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runIngest({ command: "ingest", file: "session.txt", stdin: false, tool: "test", format: "text" });
    expect(stdout).toHaveBeenCalledWith(JSON.stringify(ingestion, null, 2) + "\n");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Ingestion completed, but the pending reminder is unavailable"));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("diag_reminder"));
  });
});
