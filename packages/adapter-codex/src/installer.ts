import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installHooks } from "../../adapter-hooks/src/installer";
import { hookCommand, updateInstructions, updateSettings } from "./config";

export async function installAdapter(
  install: boolean,
  directory = process.env.CODEX_HOME || join(homedir(), ".codex"),
  runtime = fileURLToPath(new URL("./capture.js", import.meta.url)),
  cli = createRequire(import.meta.url).resolve("openmembrane"),
): Promise<void> {
  directory = resolve(directory);
  const command = hookCommand([
    process.execPath, join(directory, "openmembrane-capture.mjs"), cli, join(directory, "openmembrane-capture.log"),
  ]);
  await installHooks(install, directory, runtime, "hooks.json", "AGENTS.md",
    (content, enabled) => updateSettings(content, command, enabled), updateInstructions);
}
