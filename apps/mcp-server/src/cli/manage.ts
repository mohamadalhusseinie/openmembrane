import { OpenMembraneClient } from "@openmembrane/client";
import type { ManagementCommand } from "./parseArgs";
import { formatResult } from "./formatters";

export async function runManagement(cmd: ManagementCommand): Promise<void> {
  const result = await new OpenMembraneClient().call(cmd.operation, cmd.input);
  process.stdout.write(formatResult(result, cmd.output) + "\n");
}
