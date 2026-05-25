import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { LlmMemoryExtractor } from "@openmembrain/extractor-llm";
import type { ExtractionConfig } from "@openmembrain/core";

function createMockClient(responses: string[]) {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const content = responses[callIndex] ?? "[]";
          callIndex++;
          return {
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          };
        }),
      },
    },
  } as unknown as OpenAI;
}

const baseConfig: ExtractionConfig = {
  provider: "llm",
  enabled: true,
  model: "gpt-4o",
};

describe("LlmMemoryExtractor", () => {
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
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "We use pnpm for package management.",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Use pnpm for package management");
    expect(results[0]!.projectId).toBe("proj-1");
    expect(client.chat.completions.create).toHaveBeenCalledOnce();
  });

  it("returns empty array for empty session text", async () => {
    const client = createMockClient([]);
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "   ",
    });

    expect(results).toEqual([]);
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it("handles API errors gracefully", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error("API rate limit");
          }),
        },
      },
    } as unknown as OpenAI;
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

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
    const extractor = new LlmMemoryExtractor(
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
    const extractor = new LlmMemoryExtractor(
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
    const extractor = new LlmMemoryExtractor(baseConfig, {
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

  it("works without apiKey for local models", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
      model: "llama3.1",
      baseUrl: "http://localhost:11434/v1",
    };
    const extractor = new LlmMemoryExtractor(config, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    expect(results).toEqual([]);
  });

  it("does not send response_format when jsonMode is false", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const config: ExtractionConfig = {
      ...baseConfig,
      jsonMode: false,
    };
    const extractor = new LlmMemoryExtractor(config, { client });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("response_format");
  });

  it("sends response_format when jsonMode is true (default)", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toHaveProperty("response_format", { type: "json_object" });
  });

  it("extracts JSON from markdown fences when jsonMode is off", async () => {
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
    const config: ExtractionConfig = { ...baseConfig, jsonMode: false };
    const extractor = new LlmMemoryExtractor(config, { client });

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
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    await extractor.extract({
      projectId: "proj-1",
      summary: "Summary text",
      transcript: "Transcript text",
    });

    expect(client.chat.completions.create).toHaveBeenCalledOnce();
    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as { messages: { content: string }[] };
    const userContent = call.messages[1]!.content;
    expect(userContent).toContain("Summary text");
    expect(userContent).toContain("Transcript text");
  });
});
