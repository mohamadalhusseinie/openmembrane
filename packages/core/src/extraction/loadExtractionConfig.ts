import { env } from "node:process";
import { type ExtractionConfig, type ExtractionProvider } from "./ExtractionConfig";

export function loadExtractionConfig(): ExtractionConfig {
  const apiKey = env.OPENMEMBRAIN_EXTRACTION_API_KEY;
  const model = env.OPENMEMBRAIN_EXTRACTION_MODEL;
  const baseUrl = env.OPENMEMBRAIN_EXTRACTION_BASE_URL;
  const explicitEnabled = env.OPENMEMBRAIN_EXTRACTION_ENABLED;
  const explicitProvider = env.OPENMEMBRAIN_EXTRACTION_PROVIDER as ExtractionProvider | undefined;
  const jsonModeEnv = env.OPENMEMBRAIN_EXTRACTION_JSON_MODE;
  const jsonMode = jsonModeEnv === undefined ? undefined : jsonModeEnv !== "false";

  // No API key and no explicit provider: fall back to mock
  if (!apiKey && !explicitProvider) {
    return {
      provider: "mock",
      enabled: false,
      ...(model !== undefined ? { model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(jsonMode !== undefined ? { jsonMode } : {}),
    };
  }

  // Provider explicitly set without API key (local models): require explicit ENABLED=true
  if (!apiKey && explicitProvider) {
    const enabled = explicitEnabled === "true";
    return {
      provider: explicitProvider,
      enabled,
      ...(model !== undefined ? { model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(jsonMode !== undefined ? { jsonMode } : {}),
    };
  }

  // API key present: auto-enable unless explicitly disabled, default provider to "llm"
  const enabled = explicitEnabled === "false" ? false : true;
  const provider: ExtractionProvider = explicitProvider ?? "llm";

  return {
    provider,
    enabled,
    apiKey,
    ...(model !== undefined ? { model } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(jsonMode !== undefined ? { jsonMode } : {}),
  };
}
