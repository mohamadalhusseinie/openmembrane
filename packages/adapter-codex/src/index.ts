#!/usr/bin/env node
import { installAdapter } from "./installer";

const [command, ...flags] = process.argv.slice(2);
if ((command !== "install" && command !== "uninstall") || flags.length) {
  process.stderr.write("Usage: openmembrane-codex install | uninstall\n");
  process.exitCode = 1;
} else {
  installAdapter(command === "install").then(() => {
    process.stdout.write(`OpenMembrane Codex hooks ${command === "install" ? "installed" : "uninstalled"}. Restart Codex${command === "install" ? " and review/trust the hook with /hooks" : ""}.\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`[openmembrane] ${error instanceof Error ? error.message : "Adapter configuration failed."}\n`);
    process.exitCode = 1;
  });
}
