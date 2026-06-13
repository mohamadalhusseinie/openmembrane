import { describe, expect, it, vi } from "vitest";
import {
  createExtractor,
  MockMemoryExtractor,
  type ExtractionConfig,
  type MemoryExtractor,
  type OnExtractionDiagnostics,
} from "@openmembrane/core";
import { OpenMembraneError } from "@openmembrane/core";

class FakeLlmExtractor implements MemoryExtractor {
  async extract() { return []; }
}

const fakeProviders = {
  llm: (_config: ExtractionConfig, _opts?: { onDiagnostics?: OnExtractionDiagnostics | undefined }) =>
    new FakeLlmExtractor(),
};

describe("createExtractor", () => {
  it("returns MockMemoryExtractor when provider is 'mock'", () => {
    const config: ExtractionConfig = { provider: "mock", enabled: true };
    const extractor = createExtractor(config);
    expect(extractor).toBeInstanceOf(MockMemoryExtractor);
  });

  it("returns MockMemoryExtractor when enabled is false regardless of provider", () => {
    const config: ExtractionConfig = { provider: "llm", enabled: false };
    const extractor = createExtractor(config, { providers: fakeProviders });
    expect(extractor).toBeInstanceOf(MockMemoryExtractor);
  });

  it("uses provider factory from providers map for llm", () => {
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
    };
    const extractor = createExtractor(config, { providers: fakeProviders });
    expect(extractor).toBeInstanceOf(FakeLlmExtractor);
  });

  it("does not throw for llm provider without apiKey", () => {
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1",
    };
    const extractor = createExtractor(config, { providers: fakeProviders });
    expect(extractor).toBeInstanceOf(FakeLlmExtractor);
  });

  it("throws EXTRACTION_CONFIG_ERROR for anthropic without apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "anthropic", enabled: true };
    expect(() => createExtractor(config, { providers: fakeProviders })).toThrow(OpenMembraneError);
    try {
      createExtractor(config, { providers: fakeProviders });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenMembraneError);
      expect((err as OpenMembraneError).code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("throws EXTRACTION_CONFIG_ERROR when provider is not in providers map", () => {
    const config: ExtractionConfig = {
      provider: "anthropic",
      enabled: true,
      apiKey: "test-key",
    };
    expect(() => createExtractor(config)).toThrow(OpenMembraneError);
    try {
      createExtractor(config);
    } catch (err) {
      expect(err).toBeInstanceOf(OpenMembraneError);
      expect((err as OpenMembraneError).code).toBe("EXTRACTION_CONFIG_ERROR");
    }
  });

  it("passes onDiagnostics to provider factory", () => {
    const factory = vi.fn(() => new FakeLlmExtractor());
    const onDiagnostics = vi.fn();
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
    };
    createExtractor(config, { providers: { llm: factory }, onDiagnostics });
    expect(factory).toHaveBeenCalledWith(config, { onDiagnostics });
  });
});
