import { describe, it, expect, afterEach, vi } from "vitest";
import { loadExtractionConfig } from "@openmembrain/core";

describe("loadExtractionConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default mock config when no env vars set", () => {
    const config = loadExtractionConfig();
    expect(config.provider).toBe("mock");
    expect(config.enabled).toBe(false);
    expect(config).not.toHaveProperty("apiKey");
    expect(config).not.toHaveProperty("model");
    expect(config).not.toHaveProperty("baseUrl");
    expect(config).not.toHaveProperty("jsonMode");
  });

  it("reads provider from OPENMEMBRAIN_EXTRACTION_PROVIDER", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "llm");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("llm");
  });

  it("reads apiKey from OPENMEMBRAIN_EXTRACTION_API_KEY", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test-123");
    const config = loadExtractionConfig();
    expect(config.apiKey).toBe("sk-test-123");
  });

  it("reads model from OPENMEMBRAIN_EXTRACTION_MODEL", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_MODEL", "llama3.1");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.model).toBe("llama3.1");
  });

  it("reads baseUrl from OPENMEMBRAIN_EXTRACTION_BASE_URL", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("treats enabled=false correctly", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "false");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });

  it("defaults enabled to false when env var missing and no apiKey", () => {
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });

  it("auto-enables when API key is present and ENABLED not set", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test-key");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(true);
  });

  it("defaults provider to llm when API key is present but no provider specified", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test-key");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("llm");
  });

  it("explicit ENABLED=false overrides auto-enable when API key is present", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test-key");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "false");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });

  it("forces mock fallback when no API key and no explicit provider", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("mock");
    expect(config.enabled).toBe(false);
  });

  it("allows keyless llm provider with explicit ENABLED=true (local models)", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "llm");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_MODEL", "llama3.1");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("llm");
    expect(config.enabled).toBe(true);
    expect(config).not.toHaveProperty("apiKey");
    expect(config.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.model).toBe("llama3.1");
  });

  it("keyless llm provider requires explicit ENABLED=true", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "llm");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_BASE_URL", "http://localhost:11434/v1");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("llm");
    expect(config.enabled).toBe(false);
  });

  it("reads jsonMode=true from OPENMEMBRAIN_EXTRACTION_JSON_MODE", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_JSON_MODE", "true");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.jsonMode).toBe(true);
  });

  it("reads jsonMode=false from OPENMEMBRAIN_EXTRACTION_JSON_MODE", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_JSON_MODE", "false");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.jsonMode).toBe(false);
  });

  it("omits jsonMode when env var not set", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config).not.toHaveProperty("jsonMode");
  });

  it("works unchanged when all env vars are explicitly set", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "llm");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_API_KEY", "sk-full");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_MODEL", "gpt-4o");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_JSON_MODE", "true");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("llm");
    expect(config.apiKey).toBe("sk-full");
    expect(config.model).toBe("gpt-4o");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.jsonMode).toBe(true);
  });
});
