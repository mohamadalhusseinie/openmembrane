import { rename } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { replacePrivateFile } from "../../../apps/daemon/src/privateFiles";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  rename: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("retries transient Windows atomic-replacement failures without changing the paths", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  vi.useFakeTimers();
  const busy = Object.assign(new Error("private detail"), { code: "EPERM" });
  vi.mocked(rename).mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue(undefined);
  const replacement = replacePrivateFile("draft", "discovery");
  await vi.runAllTimersAsync();
  await replacement;
  expect(rename).toHaveBeenCalledTimes(3);
  expect(vi.mocked(rename).mock.calls).toEqual([
    ["draft", "discovery"], ["draft", "discovery"], ["draft", "discovery"],
  ]);
});

it("fails persistent Windows replacement errors after bounded retries", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  vi.useFakeTimers();
  const busy = Object.assign(new Error("private detail"), { code: "EBUSY" });
  vi.mocked(rename).mockRejectedValue(busy);
  const result = expect(replacePrivateFile("draft", "discovery")).rejects.toMatchObject({
    code: "DAEMON_PRIVATE_PUBLICATION", cause: busy,
  });
  await vi.runAllTimersAsync();
  await result;
  expect(rename).toHaveBeenCalledTimes(6);
});

it("does not retry non-transient errors or permission errors on POSIX", async () => {
  const denied = Object.assign(new Error("private detail"), { code: "EPERM" });
  vi.stubGlobal("process", { ...process, platform: "linux" });
  vi.mocked(rename).mockRejectedValue(denied);
  await expect(replacePrivateFile("draft", "discovery")).rejects.toMatchObject({
    code: "DAEMON_PRIVATE_PUBLICATION", cause: denied,
  });
  expect(rename).toHaveBeenCalledTimes(1);
  vi.stubGlobal("process", { ...process, platform: "win32" });
  vi.mocked(rename).mockRejectedValue(Object.assign(new Error("private detail"), { code: "ENOENT" }));
  await expect(replacePrivateFile("draft", "discovery")).rejects.toMatchObject({ code: "DAEMON_PRIVATE_PUBLICATION" });
  expect(rename).toHaveBeenCalledTimes(2);
});
