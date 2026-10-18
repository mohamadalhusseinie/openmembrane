import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installHooks } from "../../adapter-hooks/src/installer";
import { hookCommand, updateInstructions, updateSettings } from "./config";

export function resolveGlobalCli(root: string): string {
  return createRequire(import.meta.url).resolve(join(root, "openmembrane"));
}

async function globalCli(): Promise<string> {
  try {
    const root = await new Promise<string>((accept, reject) => {
      const windows = process.platform === "win32";
      execFile(windows ? process.env.ComSpec ?? "cmd.exe" : "npm",
        windows ? ["/d", "/s", "/c", "npm root --global"] : ["root", "--global"],
        { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
          if (error) reject(error);
          else accept(stdout.trim());
        });
    });
    return resolveGlobalCli(root);
  } catch {
    throw new Error("A persistent global OpenMembrane CLI is required. Run npm install -g openmembrane, then reinstall the Codex adapter.");
  }
}

export async function installAdapter(
  install: boolean,
  directory = process.env.CODEX_HOME || join(homedir(), ".codex"),
  runtime = fileURLToPath(new URL("./capture.js", import.meta.url)),
  cli?: string,
): Promise<void> {
  directory = resolve(directory);
  const installedCli = cli ?? (install ? await globalCli() : "");
  const command = hookCommand([
    process.execPath, join(directory, "openmembrane-capture.mjs"), installedCli, join(directory, "openmembrane-capture.log"),
  ]);
  await installHooks(install, directory, runtime, "hooks.json", "AGENTS.md",
    (content, enabled) => updateSettings(content, command, enabled), updateInstructions);
}
