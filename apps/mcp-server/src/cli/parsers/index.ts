import type { InputFormat } from "../parseArgs";
import { parseOpenAiChat } from "./openaiChat";

/**
 * Parses raw file content into a transcript string based on the specified format.
 * When format is "auto", detects whether the content is OpenAI chat JSON or plain text.
 */
export function parseSessionContent(content: string, format: InputFormat): string {
  if (format === "text") {
    return content;
  }

  if (format === "openai-chat") {
    return parseOpenAiChat(content);
  }

  // Auto-detect
  const trimmed = content.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return parseOpenAiChat(content);
    } catch {
      // Not valid OpenAI chat JSON — treat as plain text
      return content;
    }
  }

  return content;
}
