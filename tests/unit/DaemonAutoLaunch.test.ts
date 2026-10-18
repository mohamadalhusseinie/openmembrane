import { ChildProcess, spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { autoLaunchDaemon, createDaemonAutoLaunch, E_DAEMON_NOT_RUNNING, OpenMembraneClientError } from "@openmembrane/client";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

describe("detached daemon auto-launch", () => {
  it("spawns detached without inheriting stdio and unreferences the child", async () => {
    const child = new ChildProcess();
    const unref = vi.spyOn(child, "unref");
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const launch = createDaemonAutoLaunch("node", ["daemon.js"], { cwd: process.cwd(), env: { TEST: "1" } });
    await launch();
    expect(spawn).toHaveBeenCalledWith("node", ["daemon.js"], {
      cwd: process.cwd(), env: { TEST: "1" }, detached: true, stdio: "ignore", windowsHide: true,
    });
    expect(unref).toHaveBeenCalledOnce();
  });

  it("reports spawn failures", async () => {
    const child = new ChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    });
    await expect(createDaemonAutoLaunch("missing")()).rejects.toMatchObject({ code: "E_DAEMON_LAUNCH_FAILED" });
  });

  it("polls through transient unavailability and respects remaining time", async () => {
    const launch = vi.fn();
    const health = vi.fn()
      .mockRejectedValueOnce(new OpenMembraneClientError(E_DAEMON_NOT_RUNNING, "Not running"))
      .mockRejectedValueOnce(new OpenMembraneClientError("E_REQUEST_TIMEOUT", "Timed out"))
      .mockResolvedValue({});
    await autoLaunchDaemon(launch, health, { timeoutMs: 100, pollIntervalMs: 1 });
    expect(launch).toHaveBeenCalledOnce();
    expect(health).toHaveBeenCalledTimes(3);
    for (const [remaining] of health.mock.calls) expect(remaining).toBeGreaterThan(0);
  });

  it("does not suppress protocol or authentication errors while polling", async () => {
    const error = new OpenMembraneClientError("E_INVALID_RESPONSE", "Wrong daemon");
    await expect(autoLaunchDaemon(vi.fn(), () => Promise.reject(error))).rejects.toBe(error);
    const remoteError = new OpenMembraneClientError(E_DAEMON_NOT_RUNNING, "Remote error", { origin: "daemon" });
    await expect(autoLaunchDaemon(vi.fn(), () => Promise.reject(remoteError))).rejects.toBe(remoteError);
    await expect(autoLaunchDaemon(vi.fn(), vi.fn(), { timeoutMs: 0 })).rejects.toMatchObject({ code: "E_CLIENT_CONFIG" });
  });

  it("waits for a daemon reporting startup without suppressing other daemon errors", async () => {
    const health = vi.fn()
      .mockRejectedValueOnce(new OpenMembraneClientError("DAEMON_STARTING", "Starting.", { origin: "daemon", status: 503 }))
      .mockResolvedValue({});
    await autoLaunchDaemon(vi.fn(), health, { timeoutMs: 100, pollIntervalMs: 1 });
    expect(health).toHaveBeenCalledTimes(2);
    for (const code of ["DAEMON_STOPPING", "UNAUTHORIZED", "E_REQUEST_TIMEOUT"]) {
      const error = new OpenMembraneClientError(code, "Terminal daemon error.", { origin: "daemon" });
      await expect(autoLaunchDaemon(vi.fn(), () => Promise.reject(error))).rejects.toBe(error);
    }
  });

  it("bounds repeated startup responses by the readiness deadline", async () => {
    const starting = new OpenMembraneClientError("DAEMON_STARTING", "Starting.", { origin: "daemon", status: 503 });
    const health = vi.fn().mockRejectedValue(starting);
    await expect(autoLaunchDaemon(vi.fn(), health, { timeoutMs: 30, pollIntervalMs: 1 })).rejects.toMatchObject({
      code: E_DAEMON_NOT_RUNNING, cause: starting,
    });
    expect(health).toHaveBeenCalled();
  });
});
