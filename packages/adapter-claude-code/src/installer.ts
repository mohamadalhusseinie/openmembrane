import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installHooks } from "../../adapter-hooks/src/installer";
import { updateInstructions, updateSettings } from "./config";

export async function installAdapter(
  install: boolean,
  incremental = false,
  directory = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  runtime = fileURLToPath(new URL("./capture.js", import.meta.url)),
  cli = createRequire(import.meta.url).resolve("openmembrane"),
): Promise<void> {
  directory = resolve(directory);
  const hook = {
    type: "command" as const, command: process.execPath,
    args: [join(directory, "openmembrane-capture.mjs"), cli, join(directory, "openmembrane-capture.log")],
    timeout: 60,
  };
  await installHooks(install, directory, runtime, "settings.json", "CLAUDE.md",
    (content, enabled) => updateSettings(content, hook, enabled, incremental), updateInstructions);
}
