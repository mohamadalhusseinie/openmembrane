function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sessionTranscript(content: string, lastAssistantMessage?: string): string {
  const messages = content.split(/\r?\n/).flatMap((line, index) => {
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
  });
  if (lastAssistantMessage?.trim()) {
    const last = `assistant:\n${lastAssistantMessage}`;
    if (messages.at(-1)?.trim() !== last.trim()) messages.push(last);
  }
  return messages.join("\n\n");
}

export function transcriptChunks(transcript: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < transcript.length;) {
    let end = Math.min(start + MAX_TRANSCRIPT_LENGTH, transcript.length);
    if (end < transcript.length) {
      const newline = transcript.lastIndexOf("\n", end - 1);
      if (newline > start + MAX_TRANSCRIPT_LENGTH / 2) end = newline + 1;
      else if (/[\uD800-\uDBFF]/.test(transcript.charAt(end - 1))) end--;
    }
    chunks.push(transcript.slice(start, end));
    start = end;
  }
  return chunks;
}

export function parseHookInput(content: string): {
  cwd: string; transcriptPath: string; sessionId: string; lastAssistantMessage?: string;
} {
  const input: unknown = JSON.parse(content);
  if (!object(input) || (input.hook_event_name !== "SessionEnd" && input.hook_event_name !== "Stop") ||
      typeof input.cwd !== "string" || !input.cwd.trim() ||
      typeof input.session_id !== "string" || !input.session_id.trim() ||
      typeof input.transcript_path !== "string" || !input.transcript_path.trim()) {
    throw new Error("Expected a SessionEnd or Stop payload with session_id, cwd and transcript_path.");
  }
  return {
    cwd: input.cwd, transcriptPath: input.transcript_path, sessionId: input.session_id,
    ...(input.hook_event_name === "Stop" && typeof input.last_assistant_message === "string"
      ? { lastAssistantMessage: input.last_assistant_message } : {}),
  };
}
import { MAX_TRANSCRIPT_LENGTH } from "@openmembrane/core";
