import { OpenMembrainError } from "../errors/OpenMembrainError";
import type { ExtractionConfig } from "./ExtractionConfig";
import { validateExtractionConfig } from "./ExtractionConfig";
import type { OnExtractionDiagnostics } from "./ExtractionDiagnostics";
import type { MemoryExtractor } from "./MemoryExtractor";
import { MockMemoryExtractor } from "./MockMemoryExtractor";

export type ExtractorFactory = (
  config: ExtractionConfig,
  options?: { onDiagnostics?: OnExtractionDiagnostics | undefined },
) => MemoryExtractor;

export interface CreateExtractorOptions {
  providers?: Readonly<Record<string, ExtractorFactory>> | undefined;
  onDiagnostics?: OnExtractionDiagnostics | undefined;
}

export function createExtractor(
  config: ExtractionConfig,
  options?: CreateExtractorOptions,
): MemoryExtractor {
  const validation = validateExtractionConfig(config);
  if (!validation.ok) {
    throw validation.error;
  }

  if (!config.enabled || config.provider === "mock") {
    return new MockMemoryExtractor();
  }

  const factory = options?.providers?.[config.provider];
  if (!factory) {
    throw new OpenMembrainError({
      code: "EXTRACTION_CONFIG_ERROR",
      message: `Provider "${config.provider}" is not registered. Pass it via the providers option.`,
      safeMessage: `Provider "${config.provider}" is not available.`,
    });
  }

  return factory(config, {
    ...(options?.onDiagnostics !== undefined ? { onDiagnostics: options.onDiagnostics } : {}),
  });
}
