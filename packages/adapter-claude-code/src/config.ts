export const startMarker = "<!-- openmembrane:start -->";
export const endMarker = "<!-- openmembrane:end -->";
export const instructionBlock = `${startMarker}
# OpenMembrane retrieval

When OpenMembrane MCP tools are available, at session start call
get_project_rules and get_relevant_context with the current task to load
project rules and relevant context. Surface pending candidates with
list_memory_candidates and let the developer decide what to retain.
Session capture is automatic; do not call remember just to duplicate it.
Only retrieve stored memory into a model when the developer has explicitly
allowed that memory egress for the configured provider.
${endMarker}`;

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface HookCommand {
  type: "command";
  command: string;
  args: string[];
  timeout: number;
}

export function updateSettings(content: string | null, command: HookCommand, install: boolean, incremental = false): string {
  const settings: unknown = content === null ? {} : JSON.parse(content);
  if (!object(settings)) throw new Error("Claude settings must be a JSON object.");
  if (settings.hooks !== undefined && !object(settings.hooks)) throw new Error("Claude hooks must be an object.");
  const hooks: JsonObject = { ...(settings.hooks as JsonObject | undefined) };
  for (const event of ["SessionEnd", "Stop"]) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) throw new Error(`${event} hooks must be an array.`);
    const remaining = (groups as unknown[] | undefined ?? []).flatMap((group) => {
      if (!object(group) || !Array.isArray(group.hooks)) throw new Error(`Invalid ${event} hook group.`);
      const handlers = group.hooks.filter((handler: unknown) =>
        !object(handler) || handler.type !== "command" || !Array.isArray(handler.args) ||
        handler.args[0] !== command.args[0]);
      if (handlers.length === group.hooks.length) return [group];
      return handlers.length ? [{ ...group, hooks: handlers }] : [];
    });
    if (install && (event === "SessionEnd" || incremental)) remaining.push({ hooks: [command] });
    if (remaining.length) hooks[event] = remaining;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length || settings.hooks !== undefined) settings.hooks = hooks;
  if (!Object.keys(hooks).length) delete settings.hooks;
  return JSON.stringify(settings, null, 2) + "\n";
}

export function updateInstructions(content: string, install: boolean): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if ((start < 0) !== (end < 0) || (start >= 0 && (end < start ||
      content.indexOf(startMarker, start + startMarker.length) >= 0 ||
      content.indexOf(endMarker, end + endMarker.length) >= 0))) {
    throw new Error("Malformed OpenMembrane instruction markers; repair CLAUDE.md before installing.");
  }
  if (start >= 0) return content.slice(0, start) + (install ? instructionBlock : "") + content.slice(end + endMarker.length);
  if (!install) return content;
  return content + (content && !content.endsWith("\n") ? "\n" : "") + instructionBlock + "\n";
}
