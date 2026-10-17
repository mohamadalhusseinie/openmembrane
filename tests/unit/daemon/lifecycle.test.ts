import { ChildProcess, spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { runDaemonCommand } from "../../../apps/daemon/src/lifecycle";
import { startDaemon } from "../../../apps/daemon/src/server";
import { daemonOwnsLock, readLock } from "../../../apps/daemon/src/lock";
import { sendRequest } from "../../../packages/client/src/transport";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn(),
}));
vi.mock("../../../apps/daemon/src/server", () => ({ startDaemon: vi.fn() }));
vi.mock("../../../apps/daemon/src/lock", () => ({
  readLock: vi.fn(), daemonOwnsLock: vi.fn(), processAlive: vi.fn(() => true),
}));
vi.mock("../../../packages/client/src/transport", () => ({ sendRequest: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("launches detached serve without GitHub credentials and leaves the caller environment intact", async () => {
  vi.stubEnv("GH_TOKEN", "test-gh-token");
  vi.stubEnv("GITHUB_ENTERPRISE_TOKEN", "test-enterprise-token");
  vi.stubEnv("GH_CONFIG_DIR", "test-config");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(readLock).mockResolvedValueOnce(undefined).mockResolvedValue({
    pid: process.pid, instanceId: "test-instance", endpoint: { transport: "tcp", host: "127.0.0.1", port: 12345 },
  });
  vi.mocked(daemonOwnsLock).mockResolvedValue(true);
  vi.mocked(sendRequest).mockResolvedValue({ status: 200, value: {} });
  vi.mocked(spawn).mockImplementation(() => {
    const child = new ChildProcess();
    vi.spyOn(child, "unref").mockImplementation(() => undefined);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  await runDaemonCommand("start");
  const env = vi.mocked(spawn).mock.calls[0]?.[2]?.env;
  expect(env).toBeDefined();
  expect(env).not.toHaveProperty("GH_TOKEN");
  expect(env).not.toHaveProperty("GITHUB_ENTERPRISE_TOKEN");
  expect(env?.GH_CONFIG_DIR).toBe("test-config");
  expect(process.env.GH_TOKEN).toBe("test-gh-token");
});

it("removes inherited GitHub credentials before foreground daemon initialization", async () => {
  vi.stubEnv("GH_TOKEN", "test-gh-token");
  vi.stubEnv("GITHUB_TOKEN", "test-github-token");
  vi.stubEnv("GH_CONFIG_DIR", "test-config");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.mocked(startDaemon).mockImplementation(async () => {
    expect(process.env.GH_TOKEN).toBeUndefined();
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
    expect(process.env.GH_CONFIG_DIR).toBe("test-config");
    return {
      endpoint: { transport: "tcp", host: "127.0.0.1", port: 12345 },
      closed: Promise.resolve(), close: vi.fn(async () => undefined),
    };
  });
  await runDaemonCommand("serve");
  expect(startDaemon).toHaveBeenCalledOnce();
});
