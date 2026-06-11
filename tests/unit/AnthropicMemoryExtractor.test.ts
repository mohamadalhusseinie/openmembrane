import { describe, it, expect, vi } from "vitest";
import { AnthropicMemoryExtractor } from "@openmembrain/extractor-anthropic";
import type { AnthropicClient } from "@openmembrain/extractor-anthropic";
import type { ExtractionConfig } from "@openmembrain/core";

function createMockClient(responses: string[]) {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const text = responses[callIndex] ?? "[]";
        callIndex++;
        return {
          content: [{ type: "text", text }],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }),
    },
  } satisfies AnthropicClient;
}

const baseConfig: ExtractionConfig = {
  provider: "anthropic",
  enabled: true,
  apiKey: "sk-ant-test-key",
  model: "claude-sonnet-4-20250514",
};

describe("AnthropicMemoryExtractor", () => {
  it("extracts candidates from a simple session transcript", async () => {
    const response = JSON.stringify({
      memories: [
        {
          content: "Use pnpm for package management",
          type: "project_fact",
          scope: "tooling",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "Mentioned in transcript",
          tags: ["tooling"],
        },
      ],
    });
    const client = createMockClient([response]);
    const extractor = new AnthropicMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "We use pnpm for package management.",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Use pnpm for package management");
    expect(results[0]!.projectId).toBe("proj-1");
    expect(client.messages.create).toHaveBeenCalledOnce();
  });

  it("returns empty array for empty session text", async () => {
    const client = createMockClient([]);
    const extractor = new AnthropicMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "   ",
    });

    expect(results).toEqual([]);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("handles API errors gracefully", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => {
          throw new Error("API rate limit");
        }),
      },
    } satisfies AnthropicClient;
    const extractor = new AnthropicMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content here",
    });

    expect(results).toEqual([]);
  });

  it("chunks long transcripts and merges results", async () => {
    const mem1 = JSON.stringify({
      memories: [
        {
          content: "Fact from chunk 1",
          type: "project_fact",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "Found in chunk 1",
          tags: [],
        },
      ],
    });
    const mem2 = JSON.stringify({
      memories: [
        {
          content: "Fact from chunk 2",
          type: "coding_rule",
          scope: "backend",
          confidence: "medium",
          sensitivity: "internal",
          recommendedAction: "ask_user",
          reason: "Found in chunk 2",
          tags: [],
        },
      ],
    });
    const client = createMockClient([mem1, mem2]);
    const extractor = new AnthropicMemoryExtractor(
      { ...baseConfig, maxChunkCharacters: 50 },
      { client },
    );

    const longText = "A".repeat(60) + "\n\n" + "B".repeat(60);
    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: longText,
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe("Fact from chunk 1");
    expect(results[1]!.content).toBe("Fact from chunk 2");
  });

  it("deduplicates across chunks", async () => {
    const sameMem = JSON.stringify({
      memories: [
        {
          content: "Use TypeScript strict mode",
          type: "coding_rule",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "Repeated",
          tags: [],
        },
      ],
    });
    const client = createMockClient([sameMem, sameMem]);
    const extractor = new AnthropicMemoryExtractor(
      { ...baseConfig, maxChunkCharacters: 50 },
      { client },
    );

    const longText = "A".repeat(60) + "\n\n" + "B".repeat(60);
    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: longText,
    });

    expect(results).toHaveLength(1);
  });

  it("calls onDiagnostics callback with token usage", async () => {
    const response = JSON.stringify({
      memories: [
        {
          content: "Some fact",
          type: "project_fact",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "test",
          tags: [],
        },
      ],
    });
    const client = createMockClient([response]);
    const onDiagnostics = vi.fn();
    const extractor = new AnthropicMemoryExtractor(baseConfig, {
      client,
      onDiagnostics,
    });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    expect(onDiagnostics).toHaveBeenCalledOnce();
    expect(onDiagnostics).toHaveBeenCalledWith({
      chunks: 1,
      totalPromptTokens: 100,
      totalCompletionTokens: 50,
      candidatesExtracted: 1,
      errors: [],
    });
  });

  it("passes system prompt as top-level parameter (not a message)", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const extractor = new AnthropicMemoryExtractor(baseConfig, { client });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    expect(client.messages.create).toHaveBeenCalledOnce();
    const call = (client.messages.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Record<string, unknown>;
    // Anthropic uses top-level system param
    expect(call).toHaveProperty("system");
    expect(typeof call.system).toBe("string");
    // Messages should only contain user messages
    const messages = call.messages as { role: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
  });

  it("extracts JSON from markdown fences in response", async () => {
    const jsonContent = JSON.stringify({
      memories: [
        {
          content: "Use ESM modules",
          type: "project_fact",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "test",
          tags: [],
        },
      ],
    });
    const wrappedResponse = "Here is the extracted knowledge:\n```json\n" + jsonContent + "\n```";
    const client = createMockClient([wrappedResponse]);
    const extractor = new AnthropicMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "We use ESM modules.",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Use ESM modules");
  });

  it("uses both summary and transcript via getSessionText", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const extractor = new AnthropicMemoryExtractor(baseConfig, { client });

    await extractor.extract({
      projectId: "proj-1",
      summary: "Summary text",
      transcript: "Transcript text",
    });

    expect(client.messages.create).toHaveBeenCalledOnce();
    const call = (client.messages.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as { messages: { content: string }[] };
    const userContent = call.messages[0]!.content;
    expect(userContent).toContain("Summary text");
    expect(userContent).toContain("Transcript text");
  });

  it("reports errors in diagnostics when API calls fail", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => {
          throw new Error("Connection timeout");
        }),
      },
    } satisfies AnthropicClient;
    const onDiagnostics = vi.fn();
    const extractor = new AnthropicMemoryExtractor(baseConfig, {
      client,
      onDiagnostics,
    });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    expect(onDiagnostics).toHaveBeenCalledOnce();
    expect(onDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        chunks: 1,
        candidatesExtracted: 0,
        errors: [{ chunk: 0, message: "Connection timeout" }],
      }),
    );
  });
});
