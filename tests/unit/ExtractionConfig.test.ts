import { describe, expect, it } from "vitest";
import {
  validateExtractionConfig,
  defaultExtractionConfig,
  type ExtractionConfig
} from "@openmembrain/core";

describe("ExtractionConfig", () => {
  it("accepts valid llm config with apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "llm", enabled: true, apiKey: "sk-test" };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("accepts valid mock config without apiKey", () => {
    const config: ExtractionConfig = { provider: "mock", enabled: true };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("accepts llm provider without apiKey when enabled (local models)", () => {
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
      model: "llama3.1",
      baseUrl: "http://localhost:11434/v1",
    };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("rejects anthropic without apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "anthropic", enabled: true };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("accepts anthropic without apiKey when not enabled", () => {
    const config: ExtractionConfig = { provider: "anthropic", enabled: false };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown provider", () => {
    const config = { provider: "grok" as never, enabled: false };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("validates defaultExtractionConfig", () => {
    const result = validateExtractionConfig(defaultExtractionConfig);
    expect(result.ok).toBe(true);
  });

  it("accepts jsonMode in config", () => {
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
      jsonMode: false,
    };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });
});
