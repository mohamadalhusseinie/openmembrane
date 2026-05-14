import { describe, expect, it, vi } from "vitest";
import {
  createExtractor,
  MockMemoryExtractor,
  type ExtractionConfig,
  type MemoryExtractor,
  type OnExtractionDiagnostics,
} from "@openmembrain/core";
import { OpenMembrainError } from "@openmembrain/core";

class FakeOpenAiExtractor implements MemoryExtractor {
  async extract() { return []; }
}

const fakeProviders = {
  openai: (_config: ExtractionConfig, _opts?: { onDiagnostics?: OnExtractionDiagnostics | undefined }) =>
    new FakeOpenAiExtractor(),
};

describe("createExtractor", () => {
  it("returns MockMemoryExtractor when provider is 'mock'", () => {
    const config: ExtractionConfig = { provider: "mock", enabled: true };
    const extractor = createExtractor(config);
    expect(extractor).toBeInstanceOf(MockMemoryExtractor);
  });

  it("returns MockMemoryExtractor when enabled is false regardless of provider", () => {
    const config: ExtractionConfig = { provider: "openai", enabled: false };
    const extractor = createExtractor(config, { providers: fakeProviders });
    expect(extractor).toBeInstanceOf(MockMemoryExtractor);
  });

  it("uses provider factory from providers map for openai", () => {
    const config: ExtractionConfig = {
      provider: "openai",
      enabled: true,
      apiKey: "test-key",
    };
    const extractor = createExtractor(config, { providers: fakeProviders });
    expect(extractor).toBeInstanceOf(FakeOpenAiExtractor);
  });

  it("throws EXTRACTION_CONFIG_ERROR for openai without apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "openai", enabled: true };
    expect(() => createExtractor(config, { providers: fakeProviders })).toThrow(OpenMembrainError);
    try {
      createExtractor(config, { providers: fakeProviders });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenMembrainError);
      expect((err as OpenMembrainError).code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("throws EXTRACTION_CONFIG_ERROR when provider is not in providers map", () => {
    const config: ExtractionConfig = {
      provider: "anthropic",
      enabled: true,
      apiKey: "test-key",
    };
    expect(() => createExtractor(config)).toThrow(OpenMembrainError);
    try {
      createExtractor(config);
    } catch (err) {
      expect(err).toBeInstanceOf(OpenMembrainError);
      expect((err as OpenMembrainError).code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("passes onDiagnostics to provider factory", () => {
    const factory = vi.fn(() => new FakeOpenAiExtractor());
    const onDiagnostics = vi.fn();
    const config: ExtractionConfig = {
      provider: "openai",
      enabled: true,
      apiKey: "test-key",
    };
    createExtractor(config, { providers: { openai: factory }, onDiagnostics });
    expect(factory).toHaveBeenCalledWith(config, { onDiagnostics });
  });
});
