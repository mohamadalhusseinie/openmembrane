import { OpenMembraneClient } from "@openmembrane/client";
import type { ContextCommand } from "./parseArgs";
import { formatMemories } from "./formatters";
import { printPendingReminderCount } from "./pendingReminder";

export async function runContext(cmd: ContextCommand): Promise<void> {
  const result = await new OpenMembraneClient().getCliContext({
    ...(cmd.project ? { projectId: cmd.project } : {}),
    ...(cmd.query ? { query: cmd.query } : {}),
    ...(cmd.type ? { type: cmd.type } : {}),
    ...(cmd.scope ? { scope: cmd.scope } : {}),
  });
  process.stdout.write(formatMemories(result.memories, cmd.output) + "\n");
  printPendingReminderCount(result.pendingCandidateCount);
}
