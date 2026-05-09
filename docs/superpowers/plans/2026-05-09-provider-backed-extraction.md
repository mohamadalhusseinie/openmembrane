# Provider-Backed Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-backed memory extraction with explicit provider configuration, prompt templating, transcript chunking, and OpenAI as the first real implementation.

**Architecture:** New modules live in `packages/core/src/extraction/`. Config is loaded from env vars. A factory function resolves the extractor from config. The extraction prompt is a separate module. The OpenAI extractor calls the API, parses structured JSON responses into `MemoryCandidate[]`. Transcripts exceeding context limits are chunked. The MCP server context wires up the config-based factory.

**Tech Stack:** TypeScript, OpenAI SDK (`openai` npm package), Vitest, existing `@openmembrain/shared` utilities.

---

## File Structure

### New files (in `packages/core/src/extraction/`):
- `ExtractionConfig.ts` — Config type, validation, defaults
- `loadExtractionConfig.ts` — Load config from environment variables
- `extractionPrompt.ts` — The prompt template (system + user message builders)
- `parseExtractionResponse.ts` — Parse LLM JSON response into `MemoryCandidate[]`
- `chunkTranscript.ts` — Split long transcripts into chunks
- `OpenAiMemoryExtractor.ts` — OpenAI `MemoryExtractor` implementation
- `createExtractor.ts` — Factory that resolves extractor from config

### Modified files:
- `packages/core/src/errors/OpenMembrainError.ts` — Add error codes
- `packages/core/src/index.ts` — Export new modules
- `packages/core/package.json` — Add `openai` dependency
- `apps/mcp-server/src/context.ts` — Wire up config-based extractor

### Test files (in `tests/unit/`):
- `ExtractionConfig.test.ts`
- `loadExtractionConfig.test.ts`
- `extractionPrompt.test.ts`
- `parseExtractionResponse.test.ts`
- `chunkTranscript.test.ts`
- `OpenAiMemoryExtractor.test.ts`
- `createExtractor.test.ts`

---

## Task 1: Add new error codes

**Files:**
- Modify: `packages/core/src/errors/OpenMembrainError.ts`

- [ ] **Step 1: Add EXTRACTION_CONFIG_ERROR and EXTRACTION_PROVIDER_ERROR to OpenMembrainErrorCode**

Add two new codes to the union type:
```ts
export type OpenMembrainErrorCode =
  | "VALIDATION_ERROR"
  | "CANDIDATE_NOT_FOUND"
  | "SECRET_CANDIDATE"
  | "EXPORT_PATH_OUTSIDE_ROOT"
  | "STORAGE_INVALID_JSON"
  | "EXTRACTION_CONFIG_ERROR"
  | "EXTRACTION_PROVIDER_ERROR"
  | "UNKNOWN_ERROR";
```

- [ ] **Step 2: Commit**

```
git add packages/core/src/errors/OpenMembrainError.ts
git commit -m "feat: add extraction error codes"
```

---

## Task 2: ExtractionConfig type and validation

**Files:**
- Create: `packages/core/src/extraction/ExtractionConfig.ts`
- Test: `tests/unit/ExtractionConfig.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { validateExtractionConfig, type ExtractionConfig } from "@openmembrain/core";

describe("validateExtractionConfig", () => {
  it("accepts a valid openai config", () => {
    const config: ExtractionConfig = {
      provider: "openai",
      enabled: true,
      apiKey: "sk-test-key-1234567890",
      model: "gpt-4o"
    };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("accepts mock provider without apiKey", () => {
    const config: ExtractionConfig = { provider: "mock", enabled: true };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("rejects openai provider without apiKey", () => {
    const config: ExtractionConfig = { provider: "openai", enabled: true };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("apiKey");
    }
  });

  it("rejects openai provider when enabled is false", () => {
    const config: ExtractionConfig = {
      provider: "openai",
      enabled: false,
      apiKey: "sk-test"
    };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown provider", () => {
    const config = { provider: "unknown", enabled: true } as ExtractionConfig;
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(false);
  });

  it("returns default config when nothing is provided", () => {
    const config: ExtractionConfig = { provider: "mock", enabled: false };
    const result = validateExtractionConfig(config);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ExtractionConfig.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

```ts
import type { Result } from "@openmembrain/shared";
import { OpenMembrainError } from "../errors/OpenMembrainError";

export const extractionProviders = ["mock", "openai", "anthropic", "local"] as const;
export type ExtractionProvider = (typeof extractionProviders)[number];

export interface ExtractionConfig {
  provider: ExtractionProvider;
  enabled: boolean;
  apiKey?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  maxChunkCharacters?: number | undefined;
}

export const defaultExtractionConfig: ExtractionConfig = {
  provider: "mock",
  enabled: false
};

export function validateExtractionConfig(
  config: ExtractionConfig
): Result<ExtractionConfig, OpenMembrainError> {
  if (!extractionProviders.includes(config.provider)) {
    return {
      ok: false,
      error: new OpenMembrainError({
        code: "EXTRACTION_CONFIG_ERROR",
        message: `Unknown extraction provider: "${config.provider}". Valid providers: ${extractionProviders.join(", ")}.`,
        safeMessage: `Unknown extraction provider: "${config.provider}".`
      })
    };
  }

  const needsApiKey = config.provider === "openai" || config.provider === "anthropic";
  if (config.enabled && needsApiKey && !config.apiKey) {
    return {
      ok: false,
      error: new OpenMembrainError({
        code: "EXTRACTION_CONFIG_ERROR",
        message: `Provider "${config.provider}" requires an apiKey when extraction is enabled.`,
        safeMessage: `Provider "${config.provider}" requires an apiKey.`
      })
    };
  }

  return { ok: true, value: config };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ExtractionConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add packages/core/src/extraction/ExtractionConfig.ts tests/unit/ExtractionConfig.test.ts
git commit -m "feat: add ExtractionConfig type and validation"
```

---

## Task 3: Load config from environment

**Files:**
- Create: `packages/core/src/extraction/loadExtractionConfig.ts`
- Test: `tests/unit/loadExtractionConfig.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { loadExtractionConfig } from "@openmembrain/core";

describe("loadExtractionConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default mock config when no env vars are set", () => {
    const config = loadExtractionConfig();
    expect(config.provider).toBe("mock");
    expect(config.enabled).toBe(false);
  });

  it("reads provider from OPENMEMBRAIN_EXTRACTION_PROVIDER", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRAIN_OPENAI_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("openai");
    expect(config.enabled).toBe(true);
    expect(config.apiKey).toBe("sk-test");
  });

  it("reads model from OPENMEMBRAIN_OPENAI_MODEL", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRAIN_OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENMEMBRAIN_OPENAI_MODEL", "gpt-4o-mini");
    const config = loadExtractionConfig();
    expect(config.model).toBe("gpt-4o-mini");
  });

  it("reads base URL from OPENMEMBRAIN_OPENAI_BASE_URL", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRAIN_OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENMEMBRAIN_OPENAI_BASE_URL", "http://localhost:11434/v1");
    const config = loadExtractionConfig();
    expect(config.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("treats OPENMEMBRAIN_EXTRACTION_ENABLED=false correctly", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "false");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });

  it("defaults enabled to false when env var is missing", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_PROVIDER", "openai");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write implementation**

```ts
import { env } from "node:process";
import { defaultExtractionConfig, type ExtractionConfig, type ExtractionProvider } from "./ExtractionConfig";

export function loadExtractionConfig(): ExtractionConfig {
  const provider = (env.OPENMEMBRAIN_EXTRACTION_PROVIDER as ExtractionProvider | undefined) ?? defaultExtractionConfig.provider;
  const enabled = env.OPENMEMBRAIN_EXTRACTION_ENABLED === "true";
  const apiKey = env.OPENMEMBRAIN_OPENAI_API_KEY;
  const model = env.OPENMEMBRAIN_OPENAI_MODEL;
  const baseUrl = env.OPENMEMBRAIN_OPENAI_BASE_URL;

  return {
    provider,
    enabled,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {})
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```
git add packages/core/src/extraction/loadExtractionConfig.ts tests/unit/loadExtractionConfig.test.ts
git commit -m "feat: add environment-based extraction config loading"
```

---

## Task 4: Extraction prompt template

**Files:**
- Create: `packages/core/src/extraction/extractionPrompt.ts`
- Test: `tests/unit/extractionPrompt.test.ts`

- [ ] **Step 1: Write failing tests**

Tests verify the prompt builders return strings containing expected instructions and that the user message includes the session text.

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write implementation**

System prompt encodes the durable knowledge criteria from product-vision.md. User prompt injects the session text. Both return plain strings.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

## Task 5: Parse LLM extraction response

**Files:**
- Create: `packages/core/src/extraction/parseExtractionResponse.ts`
- Test: `tests/unit/parseExtractionResponse.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: valid JSON array, missing fields get defaults, invalid JSON returns empty array, non-array JSON returns empty, unknown enum values get fallbacks.

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write implementation**

Parse JSON, validate each item against MemoryCandidate field requirements, assign IDs and timestamps, use safe defaults for missing/invalid enum values.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

## Task 6: Transcript chunking

**Files:**
- Create: `packages/core/src/extraction/chunkTranscript.ts`
- Test: `tests/unit/chunkTranscript.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: short text returns single chunk, long text splits at paragraph boundaries, respects max chunk size, empty text returns empty array.

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write implementation**

Split on paragraph boundaries (double newline), merge paragraphs into chunks up to max size.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

## Task 7: OpenAI memory extractor

**Files:**
- Create: `packages/core/src/extraction/OpenAiMemoryExtractor.ts`
- Modify: `packages/core/package.json` (add `openai` dependency)
- Test: `tests/unit/OpenAiMemoryExtractor.test.ts`

- [ ] **Step 1: Install openai dependency**

```
npm install openai --workspace=packages/core
```

- [ ] **Step 2: Write failing tests**

Tests mock the OpenAI client, verify: extraction returns candidates, handles API errors gracefully, chunks long transcripts, logs token usage via callback, prefers summary over transcript.

- [ ] **Step 3: Run tests to verify they fail**
- [ ] **Step 4: Write implementation**

Constructs OpenAI client from config, builds prompt, calls chat.completions.create with JSON response format, parses response, deduplicates across chunks.

- [ ] **Step 5: Run tests to verify they pass**
- [ ] **Step 6: Commit**

---

## Task 8: Provider factory

**Files:**
- Create: `packages/core/src/extraction/createExtractor.ts`
- Test: `tests/unit/createExtractor.test.ts`

- [ ] **Step 1: Write failing tests**

Tests cover: returns MockMemoryExtractor for mock/disabled config, returns OpenAiMemoryExtractor for valid openai config, throws EXTRACTION_CONFIG_ERROR for invalid config, throws for unsupported providers.

- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Write implementation**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

## Task 9: Update exports and wire up MCP server

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `apps/mcp-server/src/context.ts`

- [ ] **Step 1: Add new exports to core barrel**

Add exports for ExtractionConfig, loadExtractionConfig, createExtractor, OpenAiMemoryExtractor, extractionPrompt, parseExtractionResponse, chunkTranscript.

- [ ] **Step 2: Update context.ts to use config-based extractor**

Replace `new MockMemoryExtractor()` with `createExtractor(loadExtractionConfig())`.

- [ ] **Step 3: Run full test suite**

```
npm run check
```

- [ ] **Step 4: Commit**

```
git commit -m "feat: wire up config-based extraction in MCP server"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full typecheck and test suite**
- [ ] **Step 2: Verify no provider code leaks outside extraction/**
- [ ] **Step 3: Verify MockMemoryExtractor still works when no config is set**
