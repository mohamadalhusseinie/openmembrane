import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenMembraneClient } from "@openmembrane/client";
import { startDaemon } from "../../apps/daemon/src/server";
import type { RunningDaemon } from "../../apps/daemon/src/server";
import { createHooks } from "../../packages/adapter-opencode/src/plugin";
import { model, sessionId, sessionMessages } from "../unit/fixtures/opencodeSession";

let root: string | undefined;
let daemon: RunningDaemon | undefined;

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
  vi.unstubAllEnvs();
});

describe("OpenCode adapter through the real daemon", () => {
  it("persists knowledge automatically at idle and injects it in a later session", async () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "mock");
    vi.stubEnv("OPENMEMBRANE_HOME", "");
    root = await mkdtemp(join(tmpdir(), "om-opencode-"));
    const paths = { homeDir: root, runtimeDir: root };
    daemon = await startDaemon({ paths });
    const client = new OpenMembraneClient({ endpoint: daemon.endpoint, daemonPaths: paths, projectRoot: root, env: {} });
    const host: Parameters<typeof createHooks>[0] = {
      client: {
        session: { messages: async () => ({
          data: structuredClone(sessionMessages), request: new Request("http://localhost/session"), response: new Response(),
        }) },
        app: { log: async () => ({ data: true, request: new Request("http://localhost/log"), response: new Response() }) },
      },
    };
    const project = { projectRoot: root, projectId: basename(root) };
    const hooks = createHooks(host, client, project);
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: sessionId } } });
    const memories = await client.listMemories();
    const pending = await client.listMemoryCandidates({});
    expect(memories.length + pending.length).toBeGreaterThan(0);
    expect([...memories, ...pending]).toEqual(expect.arrayContaining([expect.objectContaining({
      source: expect.objectContaining({ tool: "opencode", sessionId }),
      content: expect.stringContaining("isolated Vitest fixtures"),
    })]));
    expect(memories.length).toBeGreaterThan(0);
    await hooks.dispose?.();
    await daemon.close();
    daemon = await startDaemon({ paths });
    const nextClient = new OpenMembraneClient({ endpoint: daemon.endpoint, daemonPaths: paths, projectRoot: root, env: {} });
    const nextSession = createHooks(host, nextClient, project);
    const output = { system: ["Host prompt"] };
    await nextSession["experimental.chat.system.transform"]?.({ sessionID: "ses_next", model }, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toMatch(/^Host prompt\n\n/);
    expect(output.system.join("\n")).toContain("isolated Vitest fixtures");
    await nextSession.dispose?.();
  }, 15_000);
});
