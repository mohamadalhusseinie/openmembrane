import { describe, expect, it, vi } from "vitest";
import { printPendingReminderCount } from "../../../apps/mcp-server/src/cli/pendingReminder";

describe("printPendingReminderCount", () => {
  it("prints nothing when no candidates exist", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    printPendingReminderCount(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints singular reminder for 1 candidate", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    printPendingReminderCount(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("1 memory candidate is waiting for review")
    );
    spy.mockRestore();
  });

  it("prints plural reminder for multiple candidates", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    printPendingReminderCount(3);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("3 memory candidates are waiting for review")
    );
    spy.mockRestore();
  });
});
