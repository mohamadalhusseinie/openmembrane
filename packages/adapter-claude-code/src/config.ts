import { updateHookSettings } from "../../adapter-hooks/src/settings";
export { startMarker, endMarker, instructionBlock, updateInstructions } from "../../adapter-hooks/src/instructions";

export interface HookCommand {
  type: "command";
  command: string;
  args: string[];
  timeout: number;
}

export function updateSettings(content: string | null, command: HookCommand, install: boolean, incremental = false): string {
  return updateHookSettings(content, install, (handler) =>
    handler.type === "command" && Array.isArray(handler.args) && handler.args[0] === command.args[0],
  { SessionEnd: command, ...(incremental ? { Stop: command } : {}) });
}
