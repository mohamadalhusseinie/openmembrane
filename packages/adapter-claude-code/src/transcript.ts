function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sessionTranscript(content: string): string {
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Invalid Claude Code transcript JSON on line ${index + 1}.`);
    }
    if (!object(record) || record.isSidechain === true || record.isApiErrorMessage === true ||
        (record.type !== "user" && record.type !== "assistant")) return [];
    if (!object(record.message)) throw new Error(`Missing message on transcript line ${index + 1}.`);
    const body = record.message.content;
    const text = typeof body === "string" ? body : Array.isArray(body)
      ? body.flatMap((part: unknown) => object(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n")
      : "";
    return text.trim() ? [`${record.type}:\n${text}`] : [];
  }).join("\n\n");
}

export function parseHookInput(content: string): { cwd: string; transcriptPath: string } {
  const input: unknown = JSON.parse(content);
  if (!object(input) || (input.hook_event_name !== "SessionEnd" && input.hook_event_name !== "Stop") ||
      typeof input.cwd !== "string" || !input.cwd.trim() ||
      typeof input.transcript_path !== "string" || !input.transcript_path.trim()) {
    throw new Error("Expected a SessionEnd or Stop payload with cwd and transcript_path.");
  }
  return { cwd: input.cwd, transcriptPath: input.transcript_path };
}
