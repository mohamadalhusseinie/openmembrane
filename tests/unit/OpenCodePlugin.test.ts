import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { createDaemonAutoLaunch, OpenMembraneClient } from "@openmembrane/client";
import type { OpenMembraneClientOptions } from "@openmembrane/client";
import OpenMembrane from "../../packages/adapter-opencode/src/index";
import { model, sessionId, sessionMessages } from "./fixtures/opencodeSession";
import { entry } from "./helpers";

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

afterEach(() => vi.restoreAllMocks());

describe("OpenCode plugin initialization", () => {
  it.each([undefined, false, true])("forwards explicit memory-egress consent from plugin options: %s", async (allowMemoryEgress) => {
    const client = createOpencodeClient({ baseUrl: "http://localhost" });
    const messages = vi.spyOn(client.session, "messages").mockResolvedValue({
      data: sessionMessages, request: new Request("http://localhost"), response: new Response(),
    });
    const rules = vi.spyOn(OpenMembraneClient.prototype, "getProjectRules").mockResolvedValue({
      rules: [entry()], pendingCandidateCount: 0,
    });
    vi.spyOn(OpenMembraneClient.prototype, "getRelevantContext").mockResolvedValue({
      memories: [], pendingCandidateCount: 0,
    });
    const hooks = await OpenMembrane(
      { directory: resolve("fixture-project"), client },
      allowMemoryEgress === undefined ? {} : { allowMemoryEgress },
    );
    const output = { system: ["Host prompt"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: sessionId, model }, output);
    if (allowMemoryEgress === true) {
      expect(rules).toHaveBeenCalledOnce();
      expect(output.system[0]).toContain("OpenMembrane project memory:");
    } else {
      expect(messages).not.toHaveBeenCalled();
      expect(rules).not.toHaveBeenCalled();
      expect(output.system).toEqual(["Host prompt"]);
    }
  });

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
