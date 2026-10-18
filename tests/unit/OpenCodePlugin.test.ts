import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { createDaemonAutoLaunch } from "@openmembrane/client";
import type { OpenMembraneClientOptions } from "@openmembrane/client";
import OpenMembrane from "../../packages/adapter-opencode/src/index";

const captured = vi.hoisted(() => ({
  options: [] as OpenMembraneClientOptions[],
  launch: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "fixture-cli.js" }),
}));

vi.mock("@openmembrane/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openmembrane/client")>();
  return {
    ...actual,
    createDaemonAutoLaunch: vi.fn(() => captured.launch),
    OpenMembraneClient: class extends actual.OpenMembraneClient {
      constructor(options: OpenMembraneClientOptions = {}) {
        super(options);
        captured.options.push(options);
      }
    },
  };
});

beforeEach(() => {
  captured.options.length = 0;
  vi.clearAllMocks();
});

describe("OpenCode plugin initialization", () => {
  it("lazily launches the peer CLI with Node rather than the standalone OpenCode executable", async () => {
    const directory = resolve("fixture-project");
    await OpenMembrane({ directory, client: createOpencodeClient({ baseUrl: "http://localhost" }) });
    expect(createDaemonAutoLaunch).not.toHaveBeenCalled();
    await captured.options[0]!.autoLaunch?.();
    expect(createDaemonAutoLaunch).toHaveBeenCalledExactlyOnceWith(
      "node", ["fixture-cli.js", "serve"], { cwd: directory },
    );
    expect(captured.launch).toHaveBeenCalledOnce();
    expect(captured.options[0]!.requestTimeoutMs).toBeUndefined();
    expect(captured.options[1]!.requestTimeoutMs).toBe(30 * 60_000);
  });
});
