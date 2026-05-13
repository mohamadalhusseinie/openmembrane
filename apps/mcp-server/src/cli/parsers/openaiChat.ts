/**
 * Parses an OpenAI chat-format JSON (array of {role, content} messages)
 * into a plain-text transcript string.
 */

interface ChatMessage {
  readonly role: string;
  readonly content: string | null | undefined;
}

export function parseOpenAiChat(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON: could not parse as OpenAI chat format.");
  }

  const messages = extractMessages(parsed);
  if (messages.length === 0) {
    throw new Error("No messages found in OpenAI chat format input.");
  }

  return messages
    .filter((m) => m.content != null && m.content.trim().length > 0)
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");
}

function extractMessages(parsed: unknown): ChatMessage[] {
  // Support both: bare array of messages, or object with a "messages" field
  if (Array.isArray(parsed)) {
    return validateMessages(parsed);
  }
  if (parsed !== null && typeof parsed === "object" && "messages" in parsed) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.messages)) {
      return validateMessages(obj.messages);
    }
  }
  throw new Error("Expected an array of messages or an object with a \"messages\" field.");
}

function validateMessages(arr: unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const item of arr) {
    if (item !== null && typeof item === "object" && "role" in item) {
      const msg = item as Record<string, unknown>;
      if (typeof msg.role === "string") {
        messages.push({
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content : null
        });
      }
    }
  }
  return messages;
}
