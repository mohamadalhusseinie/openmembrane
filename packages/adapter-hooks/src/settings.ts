export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function updateHookSettings(
  content: string | null,
  install: boolean,
  owns: (handler: Record<string, unknown>) => boolean,
  commands: Partial<Record<"SessionEnd" | "Stop", object>>,
): string {
  const settings: unknown = content === null ? {} : JSON.parse(content);
  if (!object(settings)) throw new Error("Hook settings must be a JSON object.");
  if (settings.hooks !== undefined && !object(settings.hooks)) throw new Error("Hooks must be an object.");
  const hooks = { ...(settings.hooks as Record<string, unknown> | undefined) };
  for (const event of ["SessionEnd", "Stop"] as const) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) throw new Error(`${event} hooks must be an array.`);
    const remaining = (groups as unknown[] | undefined ?? []).flatMap((group) => {
      if (!object(group) || !Array.isArray(group.hooks)) throw new Error(`Invalid ${event} hook group.`);
      const handlers = group.hooks.filter((handler: unknown) => !object(handler) || !owns(handler));
      if (handlers.length === group.hooks.length) return [group];
      return handlers.length ? [{ ...group, hooks: handlers }] : [];
    });
    if (install && commands[event]) remaining.push({ hooks: [commands[event]] });
    if (remaining.length) hooks[event] = remaining;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  return JSON.stringify(settings, null, 2) + "\n";
}
