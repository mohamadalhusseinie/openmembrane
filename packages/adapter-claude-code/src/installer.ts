import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { updateInstructions, updateSettings } from "./config";
import type { HookCommand } from "./config";

async function optionalRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

interface State {
  settings: string | null;
  instructions: string | null;
  installedSettings: string;
  installedInstructions: string;
}

function parseState(text: string): State {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" ||
      !("settings" in value) || !(value.settings === null || typeof value.settings === "string") ||
      !("instructions" in value) || !(value.instructions === null || typeof value.instructions === "string") ||
      !("installedSettings" in value) || typeof value.installedSettings !== "string" ||
      !("installedInstructions" in value) || typeof value.installedInstructions !== "string") {
    throw new Error("Invalid OpenMembrane installer state; restore it before changing the installation.");
  }
  return value as State;
}

export async function installAdapter(
  install: boolean,
  incremental = false,
  directory = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  runtime = fileURLToPath(new URL("./capture.js", import.meta.url)),
  cli = createRequire(import.meta.url).resolve("openmembrane"),
): Promise<void> {
  const settingsPath = join(directory, "settings.json");
  const instructionsPath = join(directory, "CLAUDE.md");
  const statePath = join(directory, "openmembrane-adapter-state.json");
  const capturePath = join(directory, "openmembrane-capture.mjs");
  const [settings, instructions, stateText] = await Promise.all([
    optionalRead(settingsPath), optionalRead(instructionsPath), optionalRead(statePath),
  ]);
  const state = stateText === null ? null : parseState(stateText);
  if (!install && state === null) return;
  if (install && state === null && await optionalRead(capturePath) !== null) {
    throw new Error("openmembrane-capture.mjs already exists without installer state; move it before installing.");
  }
  const hook: HookCommand = {
    type: "command", command: process.execPath,
    args: [capturePath, cli, join(directory, "openmembrane-capture.log")], timeout: 60,
  };
  let nextSettings = updateSettings(settings, hook, install, incremental);
  let nextInstructions = updateInstructions(instructions ?? "", install);
  if (!install && state) {
    if (settings === state.installedSettings) nextSettings = state.settings ?? "";
    if (instructions === state.installedInstructions) nextInstructions = state.instructions ?? "";
  }
  await mkdir(directory, { recursive: true });
  if (install) {
    await copyFile(runtime, capturePath);
    await writeFile(statePath, JSON.stringify({
      settings: state && settings !== state.installedSettings
        ? settings === null ? null : updateSettings(settings, hook, false)
        : state ? state.settings : settings,
      instructions: state && instructions !== state.installedInstructions
        ? instructions === null ? null : updateInstructions(instructions, false)
        : state ? state.instructions : instructions,
      installedSettings: nextSettings, installedInstructions: nextInstructions,
    } satisfies State, null, 2) + "\n", { mode: 0o600 });
  }
  async function persist(path: string, before: string | null, after: string, remove: boolean): Promise<void> {
    if (remove) {
      if (before !== null) await unlink(path);
    } else if (before !== after) await writeFile(path, after, { mode: 0o600 });
  }
  await persist(settingsPath, settings, nextSettings, !install && state?.settings === null && settings === state.installedSettings);
  await persist(instructionsPath, instructions, nextInstructions, !install && state?.instructions === null && instructions === state.installedInstructions);
  if (!install) {
    if (await optionalRead(capturePath) !== null) await unlink(capturePath);
    await unlink(statePath);
  }
}
