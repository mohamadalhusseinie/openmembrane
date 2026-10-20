import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function optionalRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

interface State {
  instructionsName?: string;
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

export async function installHooks(
  install: boolean,
  directory: string,
  runtime: string,
  settingsName: string,
  instructionsName: string,
  updateSettings: (content: string | null, install: boolean) => string,
  updateInstructions: (content: string, install: boolean) => string,
  allowedInstructionsNames: readonly string[] = [instructionsName],
): Promise<void> {
  directory = resolve(directory);
  const settingsPath = join(directory, settingsName);
  const statePath = join(directory, "openmembrane-adapter-state.json");
  const capturePath = join(directory, "openmembrane-capture.mjs");
  const stateText = await optionalRead(statePath);
  const state = stateText === null ? null : parseState(stateText);
  if (!install && state === null) return;
  if (state && "instructionsName" in state) {
    if (typeof state.instructionsName !== "string" || !allowedInstructionsNames.includes(state.instructionsName)) {
      throw new Error("Invalid OpenMembrane instructions filename in installer state.");
    }
    if (install && state.instructionsName !== instructionsName) {
      throw new Error("The effective instructions file changed. Uninstall and reinstall the adapter to move its retrieval instructions.");
    }
    instructionsName = state.instructionsName;
  }
  const instructionsPath = join(directory, instructionsName);
  const [settings, instructions] = await Promise.all([
    optionalRead(settingsPath), optionalRead(instructionsPath),
  ]);
  if (install && state === null && await optionalRead(capturePath) !== null) {
    throw new Error("openmembrane-capture.mjs already exists without installer state; move it before installing.");
  }
  let nextSettings = updateSettings(settings, install);
  let nextInstructions = updateInstructions(instructions ?? "", install);
  if (!install && state) {
    if (settings === state.installedSettings) nextSettings = state.settings ?? "";
    if (instructions === state.installedInstructions) nextInstructions = state.instructions ?? "";
  }
  await mkdir(directory, { recursive: true });
  if (install) {
    await copyFile(runtime, capturePath);
    await writeFile(statePath, JSON.stringify({
      instructionsName,
      settings: state && settings !== state.installedSettings
        ? settings === null ? null : updateSettings(settings, false)
        : state ? state.settings : settings,
      instructions: state && instructions !== state.installedInstructions
        ? instructions === null ? null : updateInstructions(instructions, false)
        : state ? state.instructions : instructions,
      installedSettings: nextSettings, installedInstructions: nextInstructions,
    } satisfies State, null, 2) + "\n", { mode: 0o600 });
  }
  async function persist(path: string, before: string | null, after: string, remove: boolean): Promise<void> {
    if (!install && before === null) return;
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
