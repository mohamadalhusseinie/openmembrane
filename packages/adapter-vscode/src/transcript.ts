import { extname } from "node:path";
import { OpenMembraneClientError } from "@openmembrane/client";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function transcriptTurn(role: "user" | "assistant", text: string, command?: string): string {
  return `${role}${command ? ` (/${command})` : ""}:\n${text}`;
}

export function originalParticipantResponse(participant: unknown, result: unknown): string | undefined {
  if (participant !== "openmembrane.chat" || !record(result) || !record(result.metadata)) return undefined;
  const text = result.metadata.openmembraneResponseText;
  return typeof text === "string" ? text : undefined;
}

export function exportedChatTranscript(source: string, filename: string): string {
  const text = source.replace(/^\uFEFF/, "");
  if (extname(filename).toLowerCase() !== ".json") return text;
  const invalid = (): OpenMembraneClientError => new OpenMembraneClientError(
    "E_VSCODE_CHAT_EXPORT", "Select a valid VS Code chat JSON export, or a plain-text/Markdown transcript.",
  );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (!record(data) || !Array.isArray(data.requests)) throw invalid();
  const turns: string[] = [];
  for (const request of data.requests) {
    if (!record(request)) throw invalid();
    const message: unknown = request.message;
    const prompt = typeof message === "string" ? message : record(message) ? message.text : undefined;
    if (typeof prompt !== "string") throw invalid();
    if (prompt.trim()) turns.push(transcriptTurn("user", prompt));
    if (request.response === undefined || request.response === null) continue;
    if (!Array.isArray(request.response)) throw invalid();
    const response = originalParticipantResponse(record(request.agent) ? request.agent.id : undefined, request.result) ??
      request.response.flatMap((part: unknown) => {
        if (!record(part)) throw invalid();
        if (part.kind === undefined && typeof part.value === "string") return [part.value];
        if ((part.kind === "markdownContent" || part.kind === "markdownVuln") &&
          record(part.content) && typeof part.content.value === "string") return [part.content.value];
        return [];
      }).join("");
    if (response.trim()) turns.push(transcriptTurn("assistant", response));
  }
  if (turns.length === 0) throw invalid();
  return turns.join("\n\n");
}
