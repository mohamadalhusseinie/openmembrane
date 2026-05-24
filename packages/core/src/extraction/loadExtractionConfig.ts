import { env } from "node:process";
import { type ExtractionConfig, type ExtractionProvider } from "./ExtractionConfig";

export function loadExtractionConfig(): ExtractionConfig {
  const apiKey = env.OPENMEMBRAIN_EXTRACTION_API_KEY ?? env.OPENMEMBRAIN_OPENAI_API_KEY;
  const model = env.OPENMEMBRAIN_EXTRACTION_MODEL ?? env.OPENMEMBRAIN_OPENAI_MODEL;
  const baseUrl = env.OPENMEMBRAIN_EXTRACTION_BASE_URL ?? env.OPENMEMBRAIN_OPENAI_BASE_URL;
  const explicitEnabled = env.OPENMEMBRAIN_EXTRACTION_ENABLED;
  const explicitProvider = env.OPENMEMBRAIN_EXTRACTION_PROVIDER as ExtractionProvider | undefined;

  // No API key: always fall back to mock regardless of other settings
  if (!apiKey) {
    return {
      provider: "mock",
      enabled: false,
      ...(model !== undefined ? { model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {})
    };
  }

  // API key is present: auto-enable unless explicitly disabled
  const enabled = explicitEnabled === "false" ? false : true;

  // API key is present: default provider to "openai" if not specified
  const provider: ExtractionProvider = explicitProvider ?? "openai";

  return {
    provider,
    enabled,
    apiKey,
    ...(model !== undefined ? { model } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {})
  };
}
