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

export function updateInstructions(content: string, install: boolean): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if ((start < 0) !== (end < 0) || (start >= 0 && (end < start ||
      content.indexOf(startMarker, start + startMarker.length) >= 0 ||
      content.indexOf(endMarker, end + endMarker.length) >= 0))) {
    throw new Error("Malformed OpenMembrane instruction markers; repair the instructions file before installing.");
  }
  if (start >= 0) return content.slice(0, start) + (install ? instructionBlock : "") + content.slice(end + endMarker.length);
  if (!install) return content;
  return content + (content && !content.endsWith("\n") ? "\n" : "") + instructionBlock + "\n";
}
