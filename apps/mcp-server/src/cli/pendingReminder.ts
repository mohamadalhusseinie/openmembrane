import type { PendingCandidateStore } from "@openmembrane/core";
import type { ProjectService } from "@openmembrane/service";

export async function printPendingReminder(
  store: PendingCandidateStore,
  projectId: string
): Promise<void> {
  try {
    const pending = await store.list(projectId);
    printPendingReminderCount(pending.length);
  } catch {
    // Reminder is best-effort — do not let storage errors break CLI commands.
  }
}

export function printPendingReminderCount(count: number): void {
  if (count > 0) {
    const noun = count === 1 ? "candidate is" : "candidates are";
    process.stderr.write(`\nNote: ${count} memory ${noun} waiting for review.\n`);
  }
}

export async function printProjectPendingReminder(project: Pick<ProjectService, "pendingCandidateCount">): Promise<void> {
  try {
    printPendingReminderCount(await project.pendingCandidateCount());
  } catch {
    // The reminder is best-effort, unlike the operation result.
  }
}
