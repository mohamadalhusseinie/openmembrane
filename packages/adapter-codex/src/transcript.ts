import { isAbsolute } from "node:path";
import { object } from "../../adapter-hooks/src/settings";

export function parseHookInput(content: string): { cwd: string; transcriptPath: string; sessionId: string } {
  const input: unknown = JSON.parse(content);
  if (!object(input) || input.hook_event_name !== "SessionEnd" ||
      typeof input.cwd !== "string" || !isAbsolute(input.cwd) ||
      typeof input.session_id !== "string" || !input.session_id.trim() ||
      typeof input.transcript_path !== "string" || !isAbsolute(input.transcript_path)) {
    throw new Error("Expected a SessionEnd payload with session_id and absolute cwd/transcript_path.");
  }
  return { cwd: input.cwd, transcriptPath: input.transcript_path, sessionId: input.session_id };
}

export function sessionTranscript(content: string): string {
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Invalid Codex transcript JSON on line ${index + 1}.`);
    }
    // Rollouts also contain event_msg copies, reasoning and tool records.
    if (!object(record) || record.type !== "response_item") return [];
    const message = record.payload;
    if (!object(message) || message.type !== "message" ||
        (message.role !== "user" && message.role !== "assistant")) return [];
    if (!Array.isArray(message.content)) throw new Error(`Missing message content on transcript line ${index + 1}.`);
    const text = message.content.flatMap((part: unknown) =>
      object(part) && (part.type === "input_text" || part.type === "output_text") && typeof part.text === "string"
        ? [part.text] : []).join("\n");
    return text.trim() ? [`${message.role}:\n${text}`] : [];
  }).join("\n\n");
}
