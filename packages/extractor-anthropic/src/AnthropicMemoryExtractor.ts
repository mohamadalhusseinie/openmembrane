import Anthropic from "@anthropic-ai/sdk";
import type {
  ExtractionConfig,
  MemoryCandidate,
  MemoryExtractor,
  OnExtractionDiagnostics,
  ExtractionChunkError,
  SessionInput,
} from "@openmembrain/core";
import {
  getSessionText,
  buildSystemPrompt,
  buildUserPrompt,
  chunkTranscript,
  parseExtractionResponse,
} from "@openmembrain/core";

export interface AnthropicClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
      temperature?: number | undefined;
    }): Promise<{
      content: { type: string; text?: string | undefined }[];
      usage?: { input_tokens?: number; output_tokens?: number } | undefined;
    }>;
  };
}

export class AnthropicMemoryExtractor implements MemoryExtractor {
  private readonly client: AnthropicClient;
  private readonly model: string;
  private readonly maxChunkCharacters: number | undefined;
  private readonly onDiagnostics: OnExtractionDiagnostics | undefined;

  constructor(
    config: ExtractionConfig,
    options?: {
      onDiagnostics?: OnExtractionDiagnostics | undefined;
      client?: AnthropicClient | undefined;
    },
  ) {
    this.client =
      options?.client ??
      (new Anthropic({
        apiKey: config.apiKey ?? "",
      }) as unknown as AnthropicClient);
    this.model = config.model ?? "claude-sonnet-4-20250514";
    this.maxChunkCharacters = config.maxChunkCharacters;
    this.onDiagnostics = options?.onDiagnostics;
  }

  async extract(input: SessionInput): Promise<MemoryCandidate[]> {
    const sessionText = getSessionText(input);
    if (!sessionText.trim()) {
      return [];
    }

    const chunks = chunkTranscript(sessionText, this.maxChunkCharacters);
    const systemPrompt = buildSystemPrompt();
    const allCandidates: MemoryCandidate[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const errors: ExtractionChunkError[] = [];

    for (const chunk of chunks) {
      const chunkIndex = chunks.indexOf(chunk);
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: buildUserPrompt(chunk) }],
          temperature: 0.2,
        });

        const textBlock = response.content.find((block) => block.type === "text");
        const rawContent = textBlock?.text;
        const content = rawContent ? this.extractJson(rawContent) : undefined;
        if (content) {
          const candidates = parseExtractionResponse(content, input.projectId, {
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            ...(input.tool !== undefined ? { tool: input.tool } : {}),
          });
          allCandidates.push(...candidates);
        }

        totalPromptTokens += response.usage?.input_tokens ?? 0;
        totalCompletionTokens += response.usage?.output_tokens ?? 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ chunk: chunkIndex, message });
        continue;
      }
    }

    const seen = new Set<string>();
    const deduplicated: MemoryCandidate[] = [];
    for (const candidate of allCandidates) {
      const key = candidate.content.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(candidate);
      }
    }

    this.onDiagnostics?.({
      chunks: chunks.length,
      totalPromptTokens,
      totalCompletionTokens,
      candidatesExtracted: deduplicated.length,
      errors,
    });

    return deduplicated;
  }

  /**
   * Extracts JSON from the response content. Anthropic does not support
   * JSON mode, so the model may wrap JSON in markdown fences or add
   * surrounding text.
   */
  private extractJson(raw: string): string {
    const trimmed = raw.trim();

    // If it starts with { or [ it's likely raw JSON
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return trimmed;
    }

    // Try to extract from markdown code fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      return fenceMatch[1].trim();
    }

    // Try to find a JSON object or array anywhere in the text
    const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch?.[0]) {
      return jsonMatch[0];
    }

    // Return as-is and let parseExtractionResponse handle the error
    return trimmed;
  }
}
