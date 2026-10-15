import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), readFile: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function linuxProcess(): void {
  vi.stubGlobal("process", { ...process, platform: "linux" });
}

function successfulLookup(): void {
  const record = `123 (process name) S ${Array.from({ length: 18 }, () => "0").join(" ")} 99`;
  vi.mocked(readFile).mockResolvedValueOnce(record).mockResolvedValueOnce("test-boot\n");
}

it("shares concurrent own-process lookups but retries after a failed lookup", async () => {
  linuxProcess();
  const { readProcessIdentity } = await import("../../../apps/daemon/src/processIdentity");
  vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error("test failure"), { code: "EACCES" }));
  const results = await Promise.allSettled([
    readProcessIdentity(process.pid), readProcessIdentity(process.pid),
  ]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(readFile).toHaveBeenCalledTimes(1);
  successfulLookup();
  expect(await readProcessIdentity(process.pid)).toBe("linux:test-boot:99");
  expect(await readProcessIdentity(process.pid)).toBe("linux:test-boot:99");
  expect(readFile).toHaveBeenCalledTimes(3);
});

it("does not permanently cache an unavailable own-process identity", async () => {
  linuxProcess();
  const { readProcessIdentity } = await import("../../../apps/daemon/src/processIdentity");
  vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error("test missing"), { code: "ENOENT" }));
  expect(await readProcessIdentity(process.pid)).toBeUndefined();
  successfulLookup();
  expect(await readProcessIdentity(process.pid)).toBe("linux:test-boot:99");
});

it.skipIf(process.platform !== "darwin")("keeps uncached macOS process identity stable across caller timezones", async () => {
  const { readProcessIdentity } = await import("../../../apps/daemon/src/processIdentity");
  vi.stubEnv("TZ", "Pacific/Honolulu");
  const first = await readProcessIdentity(process.ppid);
  vi.stubEnv("TZ", "Asia/Tokyo");
  const second = await readProcessIdentity(process.ppid);
  expect(first).toMatch(/^darwin:.+/);
  expect(second).toBe(first);
});
