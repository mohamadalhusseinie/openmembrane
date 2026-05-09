import { describe, expect, it } from "vitest";
import {
  validateExtractionConfig,
  defaultExtractionConfig,
  type ExtractionConfig
} from "@openmembrain/core";

describe("ExtractionConfig", () => {
  it("accepts valid openai config with apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "openai", enabled: true, apiKey: "sk-test" };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("accepts valid mock config without apiKey", () => {
    const config: ExtractionConfig = { provider: "mock", enabled: true };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("rejects openai without apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "openai", enabled: true };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("accepts openai without apiKey when not enabled", () => {
    const config: ExtractionConfig = { provider: "openai", enabled: false };
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
});
