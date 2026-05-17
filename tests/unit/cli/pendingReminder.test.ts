import { describe, expect, it, vi } from "vitest";
import { printPendingReminder } from "../../../apps/mcp-server/src/cli/pendingReminder";
import type { PendingCandidateStore } from "@openmembrain/core";

function mockStore(count: number): PendingCandidateStore {
  const items = Array.from({ length: count }, (_, i) => ({ id: `cand_${i}` }));
  return {
    list: async () => items,
    findById: async () => undefined,
    save: async () => {},
    remove: async () => {},
  } as unknown as PendingCandidateStore;
}

describe("printPendingReminder", () => {
  it("prints nothing when no candidates exist", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await printPendingReminder(mockStore(0), "test-project");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints singular reminder for 1 candidate", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await printPendingReminder(mockStore(1), "test-project");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("1 memory candidate is waiting for review")
    );
    spy.mockRestore();
  });

  it("prints plural reminder for multiple candidates", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await printPendingReminder(mockStore(3), "test-project");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("3 memory candidates are waiting for review")
    );
    spy.mockRestore();
  });
});
