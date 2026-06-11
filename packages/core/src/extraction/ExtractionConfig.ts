import type { Result } from "@openmembrain/shared";
import { OpenMembrainError } from "../errors/OpenMembrainError";

export const extractionProviders = ["mock", "llm", "anthropic"] as const;

export type ExtractionProvider = (typeof extractionProviders)[number];

export interface ExtractionConfig {
  provider: ExtractionProvider;
  enabled: boolean;
  apiKey?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  maxChunkCharacters?: number | undefined;
  jsonMode?: boolean | undefined;
}

export const defaultExtractionConfig: ExtractionConfig = {
  provider: "mock",
  enabled: false
};

export function validateExtractionConfig(
  config: ExtractionConfig
): Result<ExtractionConfig, OpenMembrainError> {
  if (!(extractionProviders as readonly string[]).includes(config.provider)) {
    return {
      ok: false,
      error: new OpenMembrainError({
        code: "EXTRACTION_CONFIG_ERROR",
        message: `Unknown extraction provider: ${config.provider as string}`,
        safeMessage: "Invalid extraction provider."
      })
    };
  }

  if (
    config.enabled &&
    config.provider === "anthropic" &&
    !config.apiKey
  ) {
    return {
      ok: false,
      error: new OpenMembrainError({
        code: "EXTRACTION_CONFIG_ERROR",
        message: `Provider "${config.provider}" requires an apiKey when enabled.`,
        safeMessage: "Missing API key for extraction provider."
      })
    };
  }

  return { ok: true, value: config };
}
