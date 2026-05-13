import { describe, expect, it } from "vitest";
import { parseOpenAiChat } from "../../../apps/mcp-server/src/cli/parsers/openaiChat";
import { parseSessionContent } from "../../../apps/mcp-server/src/cli/parsers/index";

describe("parseOpenAiChat", () => {
  it("parses a bare array of messages", () => {
    const input = JSON.stringify([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" }
    ]);
    const result = parseOpenAiChat(input);
    expect(result).toBe("[user]: Hello\n\n[assistant]: Hi there");
  });

  it("parses an object with a messages field", () => {
    const input = JSON.stringify({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "What is 2+2?" }
      ]
    });
    const result = parseOpenAiChat(input);
    expect(result).toBe("[system]: You are helpful.\n\n[user]: What is 2+2?");
  });

  it("skips messages with null or empty content", () => {
    const input = JSON.stringify([
      { role: "user", content: "Hello" },
      { role: "assistant", content: null },
      { role: "assistant", content: "" },
      { role: "user", content: "Bye" }
    ]);
    const result = parseOpenAiChat(input);
    expect(result).toBe("[user]: Hello\n\n[user]: Bye");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseOpenAiChat("not json")).toThrow("Invalid JSON");
  });

  it("throws on JSON that is not messages", () => {
    expect(() => parseOpenAiChat(JSON.stringify({ foo: "bar" }))).toThrow("Expected an array");
  });

  it("throws on empty messages array", () => {
    expect(() => parseOpenAiChat("[]")).toThrow("No messages found");
  });
});

describe("parseSessionContent", () => {
  it("returns text as-is for format='text'", () => {
    const input = '{"not": "parsed"}';
    expect(parseSessionContent(input, "text")).toBe(input);
  });

  it("parses openai-chat format explicitly", () => {
    const input = JSON.stringify([{ role: "user", content: "Hi" }]);
    const result = parseSessionContent(input, "openai-chat");
    expect(result).toBe("[user]: Hi");
  });

  it("auto-detects OpenAI chat format from array", () => {
    const input = JSON.stringify([{ role: "user", content: "Test" }]);
    const result = parseSessionContent(input, "auto");
    expect(result).toBe("[user]: Test");
  });

  it("auto-detects OpenAI chat format from object with messages", () => {
    const input = JSON.stringify({ messages: [{ role: "user", content: "Test" }] });
    const result = parseSessionContent(input, "auto");
    expect(result).toBe("[user]: Test");
  });

  it("falls back to text when JSON is not chat format", () => {
    const input = '{"foo": "bar"}';
    const result = parseSessionContent(input, "auto");
    expect(result).toBe(input);
  });

  it("treats non-JSON starting content as text in auto mode", () => {
    const input = "This is plain text transcript.";
    expect(parseSessionContent(input, "auto")).toBe(input);
  });
});
