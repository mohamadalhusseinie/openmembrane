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
    const text = message.content.flatMap((part: unknown, partIndex: number) =>
      object(part) && (part.type === "input_text" || part.type === "output_text") && typeof part.text === "string" &&
        (message.role !== "user" || userText(message, partIndex, part.text))
        ? [part.text] : []).join("\n");
    return text.trim() ? [`${message.role}:\n${text}`] : [];
  }).join("\n\n");
}
