import { cwd } from "node:process";
import { createOpenMembraneService } from "@openmembrane/service";
import type { MemoryScope, MemoryType } from "@openmembrane/core";
import type { ContextCommand } from "./parseArgs";
import { formatMemories } from "./formatters";
import { printProjectPendingReminder } from "./pendingReminder";

export async function runContext(cmd: ContextCommand): Promise<void> {
  const service = createOpenMembraneService();
  try {
    const project = await service.forProject({ projectRoot: cwd(), ...(cmd.project ? { projectId: cmd.project } : {}) });
    const memories = await project.getCliContext({
      ...(cmd.query ? { query: cmd.query } : {}),
      ...(cmd.type ? { type: cmd.type as MemoryType } : {}),
      ...(cmd.scope ? { scope: cmd.scope as MemoryScope } : {}),
    });

    const output = formatMemories(memories, cmd.output);
    process.stdout.write(output + "\n");
    await printProjectPendingReminder(project);
  } finally {
    await service.close();
  }
}
