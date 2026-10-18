#!/usr/bin/env node
import { installAdapter } from "./installer";

const [command, ...flags] = process.argv.slice(2);
if ((command !== "install" && command !== "uninstall") ||
    flags.some((flag) => flag !== "--incremental") || (command === "uninstall" && flags.length)) {
  process.stderr.write("Usage: openmembrane-claude-code install [--incremental] | uninstall\n");
  process.exitCode = 1;
} else {
  installAdapter(command === "install", flags.includes("--incremental")).then(() => {
    process.stdout.write(`OpenMembrane Claude Code hooks ${command === "install" ? "installed" : "uninstalled"}. Restart Claude Code.\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`[openmembrane] ${error instanceof Error ? error.message : "Adapter configuration failed."}\n`);
    process.exitCode = 1;
  });
}
