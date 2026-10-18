import { isAbsolute } from "node:path";
import { object } from "../../adapter-hooks/src/settings";

function userText(message: Record<string, unknown>, index: number, text: string): boolean {
  const metadata = message.internal_chat_message_metadata_passthrough;
  if (object(metadata)) {
    const kind: unknown = Array.isArray(metadata.content_item_kinds) ? metadata.content_item_kinds[index] : undefined;
    if (typeof kind === "string" && kind !== "" && kind !== "unknown") return kind.startsWith("user.");
    const part: unknown = Array.isArray(metadata.content_item_metadata) ? metadata.content_item_metadata[index] : undefined;
    if (object(part)) {
      const provenance = part.provenance;
      if (object(provenance) && typeof provenance.type === "string" &&
          provenance.type !== "unknown" && provenance.type !== "user_configured") return provenance.type === "user";
      if (part.harness_injected === true || typeof part.source_tool_namespace === "string") return false;
    }
  }
  const trimmed = text.trim();
  return !(trimmed.startsWith("# AGENTS.md instructions") && trimmed.endsWith("</INSTRUCTIONS>")) &&
    !(trimmed.startsWith("<user_shell_command>") && trimmed.endsWith("</user_shell_command>")) &&
    !(trimmed.startsWith("<environment_context>") && trimmed.endsWith("</environment_context>"));
}

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
  const messages: string[] = [];
  const userPositions: number[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Invalid Codex transcript JSON on line ${index + 1}.`);
    }
    if (!object(record)) continue;
    if (record.type === "event_msg" && object(record.payload) && record.payload.type === "thread_rolled_back") {
      const count = record.payload.num_turns;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new Error(`Invalid rollback on transcript line ${index + 1}.`);
      }
      const remaining = Math.max(0, userPositions.length - count);
      messages.length = userPositions[remaining] ?? messages.length;
      userPositions.length = remaining;
      continue;
    }
    // Other event_msg records duplicate messages or describe runtime activity.
    if (record.type !== "response_item") continue;
    const message = record.payload;
    if (!object(message) || message.type !== "message" ||
        (message.role !== "user" && message.role !== "assistant")) continue;
    if (!Array.isArray(message.content)) throw new Error(`Missing message content on transcript line ${index + 1}.`);
    if (message.role === "user" && message.content.some((part: unknown, partIndex: number) =>
      object(part) && userText(message, partIndex, typeof part.text === "string" ? part.text : ""))) {
      // Image-only user messages still delimit turns even though no text is sent.
      userPositions.push(messages.length);
    }
    const text = message.content.flatMap((part: unknown, partIndex: number) =>
      object(part) && (part.type === "input_text" || part.type === "output_text") && typeof part.text === "string" &&
        (message.role !== "user" || userText(message, partIndex, part.text))
        ? [part.text] : []).join("\n");
    if (text.trim()) messages.push(`${message.role}:\n${text}`);
  }
  return messages.join("\n\n");
}
