import OpenAI from "openai";
import type { MemoryCandidate } from "../types/MemoryCandidate";
import { getSessionText, type SessionInput } from "../types/SessionInput";
import type { ExtractionConfig } from "./ExtractionConfig";
import type { MemoryExtractor } from "./MemoryExtractor";
import { buildSystemPrompt, buildUserPrompt } from "./extractionPrompt";
import { chunkTranscript } from "./chunkTranscript";
import { parseExtractionResponse } from "./parseExtractionResponse";

import type { ExtractionChunkError, OnExtractionDiagnostics } from "./ExtractionDiagnostics";

export type { ExtractionChunkError, ExtractionDiagnostics, OnExtractionDiagnostics } from "./ExtractionDiagnostics";

export class OpenAiMemoryExtractor implements MemoryExtractor {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxChunkCharacters: number | undefined;
  private readonly onDiagnostics: OnExtractionDiagnostics | undefined;

  constructor(
    config: ExtractionConfig,
    options?: {
      onDiagnostics?: OnExtractionDiagnostics | undefined;
      client?: OpenAI | undefined;
    },
  ) {
    this.client =
      options?.client ??
      new OpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl !== undefined ? { baseURL: config.baseUrl } : {}),
      });
    this.model = config.model ?? "gpt-4o";
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
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildUserPrompt(chunk) },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const candidates = parseExtractionResponse(content, input.projectId, {
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            ...(input.tool !== undefined ? { tool: input.tool } : {}),
          });
          allCandidates.push(...candidates);
        }

        totalPromptTokens += response.usage?.prompt_tokens ?? 0;
        totalCompletionTokens += response.usage?.completion_tokens ?? 0;
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
}
