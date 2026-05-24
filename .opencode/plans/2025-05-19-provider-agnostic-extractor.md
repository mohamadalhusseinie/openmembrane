# Provider-Agnostic LLM Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OpenAI-only extractor with a universal `LlmMemoryExtractor` that works with any OpenAI-compatible API endpoint (Ollama, LM Studio, Groq, Together, DeepSeek, vLLM, OpenRouter, OpenAI, etc.)

**Architecture:** The existing `OpenAiMemoryExtractor` already uses the `openai` npm SDK with a configurable `baseUrl`. We rename it to `LlmMemoryExtractor`, make `apiKey` optional for local models, make `response_format` conditional for providers that don't support JSON mode, and update all references. The `openai` SDK stays as the HTTP client since the OpenAI chat completions format is the de facto standard.

**Tech Stack:** TypeScript ESM, `openai` npm SDK (^6.37.0), Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Delete | `packages/extractor-openai/` | Old OpenAI-specific extractor (replaced) |
| Create | `packages/extractor-llm/package.json` | New universal extractor package manifest |
| Create | `packages/extractor-llm/src/index.ts` | Package barrel export |
| Create | `packages/extractor-llm/src/LlmMemoryExtractor.ts` | Universal extractor implementation |
| Modify | `packages/core/src/extraction/ExtractionConfig.ts` | Update provider list, relax apiKey validation |
| Modify | `packages/core/src/extraction/loadExtractionConfig.ts` | Remove OpenAI-specific env vars, add JSON mode config |
| Modify | `apps/mcp-server/src/context.ts` | Import new extractor, update provider registration |
| Modify | `apps/mcp-server/package.json` | Replace extractor-openai dep with extractor-llm |
| Modify | `tsconfig.json` | Update path alias |
| Delete+Create | `tests/unit/OpenAiMemoryExtractor.test.ts` -> `tests/unit/LlmMemoryExtractor.test.ts` | Renamed+updated tests |
| Modify | `tests/unit/loadExtractionConfig.test.ts` | Update for new env vars |
| Modify | `tests/unit/createExtractor.test.ts` | Update provider names |
| Modify | `tests/unit/ExtractionConfig.test.ts` | Update provider list assertions |

---

### Task 1: Create `packages/extractor-llm` package

**Files:**
- Create: `packages/extractor-llm/package.json`
- Create: `packages/extractor-llm/src/index.ts`
- Create: `packages/extractor-llm/src/LlmMemoryExtractor.ts`

- [ ] **Step 1: Create `packages/extractor-llm/package.json`**

```json
{
  "name": "@openmembrain/extractor-llm",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@openmembrain/core": "*",
    "@openmembrain/shared": "*",
    "openai": "^6.37.0"
  }
}
```

- [ ] **Step 2: Create `packages/extractor-llm/src/index.ts`**

```ts
export { LlmMemoryExtractor } from "./LlmMemoryExtractor";
```

- [ ] **Step 3: Create `packages/extractor-llm/src/LlmMemoryExtractor.ts`**

This is the refactored extractor. Key differences from the old `OpenAiMemoryExtractor`:
- Class renamed to `LlmMemoryExtractor`
- `apiKey` defaults to empty string (local models don't need one)
- `response_format` is conditional based on `jsonMode` config flag
- When JSON mode is off, extracts JSON from freeform response (handles markdown fences, surrounding text)

```ts
import OpenAI from "openai";
import type {
  ExtractionConfig,
  MemoryCandidate,
  MemoryExtractor,
  OnExtractionDiagnostics,
  ExtractionChunkError,
  SessionInput,
} from "@openmembrain/core";
import {
  getSessionText,
  buildSystemPrompt,
  buildUserPrompt,
  chunkTranscript,
  parseExtractionResponse,
} from "@openmembrain/core";

export class LlmMemoryExtractor implements MemoryExtractor {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly jsonMode: boolean;
  private readonly maxChunkCharacters: number | undefined;
  private readonly onDiagnostics: OnExtractionDiagnostics | undefined;

  constructor(
    config: ExtractionConfig,
    options?: {
      onDiagnostics?: OnExtractionDiagnostics | undefined;
      client?: OpenAI | undefined;
    },
  ) {
    this.client =
      options?.client ??
      new OpenAI({
        apiKey: config.apiKey ?? "",
        ...(config.baseUrl !== undefined ? { baseURL: config.baseUrl } : {}),
      });
    this.model = config.model ?? "gpt-4o";
    this.jsonMode = config.jsonMode !== false;
    this.maxChunkCharacters = config.maxChunkCharacters;
    this.onDiagnostics = options?.onDiagnostics;
  }

  async extract(input: SessionInput): Promise<MemoryCandidate[]> {
    const sessionText = getSessionText(input);
    if (!sessionText.trim()) {
      return [];
    }

    const chunks = chunkTranscript(sessionText, this.maxChunkCharacters);
    const systemPrompt = buildSystemPrompt();
    const allCandidates: MemoryCandidate[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const errors: ExtractionChunkError[] = [];

    for (const chunk of chunks) {
      const chunkIndex = chunks.indexOf(chunk);
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildUserPrompt(chunk) },
          ],
          ...(this.jsonMode ? { response_format: { type: "json_object" } } : {}),
          temperature: 0.2,
        });

        const rawContent = response.choices[0]?.message?.content;
        const content = rawContent ? this.extractJson(rawContent) : undefined;
        if (content) {
          const candidates = parseExtractionResponse(content, input.projectId, {
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            ...(input.tool !== undefined ? { tool: input.tool } : {}),
          });
          allCandidates.push(...candidates);
        }

        totalPromptTokens += response.usage?.prompt_tokens ?? 0;
        totalCompletionTokens += response.usage?.completion_tokens ?? 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ chunk: chunkIndex, message });
        continue;
      }
    }

    const seen = new Set<string>();
    const deduplicated: MemoryCandidate[] = [];
    for (const candidate of allCandidates) {
      const key = candidate.content.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(candidate);
      }
    }

    this.onDiagnostics?.({
      chunks: chunks.length,
      totalPromptTokens,
      totalCompletionTokens,
      candidatesExtracted: deduplicated.length,
      errors,
    });

    return deduplicated;
  }

  /**
   * Extracts JSON from the response content. When JSON mode is disabled,
   * the model may wrap JSON in markdown fences or add surrounding text.
   */
  private extractJson(raw: string): string {
    const trimmed = raw.trim();

    // If it starts with { and ends with }, it's likely raw JSON
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed;
    }

    // Try to extract from markdown code fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      return fenceMatch[1].trim();
    }

    // Try to find a JSON object anywhere in the text
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch?.[0]) {
      return jsonMatch[0];
    }

    // Return as-is and let parseExtractionResponse handle the error
    return trimmed;
  }
}
```

- [ ] **Step 4: Run typecheck to verify the new package compiles**

Run: `npm run typecheck`
Expected: May fail due to missing path alias — fixed in Task 4.

---

### Task 2: Update `ExtractionConfig` in `packages/core`

**Files:**
- Modify: `packages/core/src/extraction/ExtractionConfig.ts`
- Modify: `tests/unit/ExtractionConfig.test.ts`

- [ ] **Step 1: Write the failing test for new provider list**

In `tests/unit/ExtractionConfig.test.ts`, add/update tests that validate:

```ts
it("accepts 'llm' as a valid provider", () => {
  const config: ExtractionConfig = {
    provider: "llm",
    enabled: true,
    model: "llama3.1",
    baseUrl: "http://localhost:11434/v1",
  };
  const result = validateExtractionConfig(config);
  expect(result.ok).toBe(true);
});

it("does not require apiKey for llm provider", () => {
  const config: ExtractionConfig = {
    provider: "llm",
    enabled: true,
    model: "llama3.1",
    baseUrl: "http://localhost:11434/v1",
  };
  const result = validateExtractionConfig(config);
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ExtractionConfig.test.ts`
Expected: FAIL — `"llm"` is not in the providers list yet.

- [ ] **Step 3: Update `ExtractionConfig.ts`**

Change `packages/core/src/extraction/ExtractionConfig.ts` to:

```ts
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
```

Key changes:
- Provider list: `["mock", "llm", "anthropic"]` — removed `"openai"` and `"local"`
- `apiKey` only required for `"anthropic"` — `"llm"` works without it
- Added `jsonMode?: boolean | undefined` to the interface

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ExtractionConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/extraction/ExtractionConfig.ts tests/unit/ExtractionConfig.test.ts
git commit -m "feat: update ExtractionConfig to support provider-agnostic 'llm' provider"
```

---

### Task 3: Update `loadExtractionConfig`

**Files:**
- Modify: `packages/core/src/extraction/loadExtractionConfig.ts`
- Modify: `tests/unit/loadExtractionConfig.test.ts`

- [ ] **Step 1: Update `loadExtractionConfig.ts`**

```ts
import { env } from "node:process";
import { defaultExtractionConfig, type ExtractionConfig, type ExtractionProvider } from "./ExtractionConfig";

export function loadExtractionConfig(): ExtractionConfig {
  const provider = (env.OPENMEMBRAIN_EXTRACTION_PROVIDER as ExtractionProvider | undefined) ?? defaultExtractionConfig.provider;
  const enabled = env.OPENMEMBRAIN_EXTRACTION_ENABLED === "true";
  const apiKey = env.OPENMEMBRAIN_EXTRACTION_API_KEY;
  const model = env.OPENMEMBRAIN_EXTRACTION_MODEL;
  const baseUrl = env.OPENMEMBRAIN_EXTRACTION_BASE_URL;
  const jsonModeEnv = env.OPENMEMBRAIN_EXTRACTION_JSON_MODE;
  const jsonMode = jsonModeEnv === undefined ? undefined : jsonModeEnv !== "false";

  return {
    provider,
    enabled,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(jsonMode !== undefined ? { jsonMode } : {}),
  };
}
```

Key changes:
- Removed `OPENMEMBRAIN_OPENAI_*` fallback env vars (clean break)
- Added `OPENMEMBRAIN_EXTRACTION_JSON_MODE` env var support

- [ ] **Step 2: Update `tests/unit/loadExtractionConfig.test.ts`**

Replace the full test file:

```ts
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
    const config = loadExtractionConfig();
    expect(config.model).toBe("llama3.1");
  });

  it("reads baseUrl from OPENMEMBRAIN_EXTRACTION_BASE_URL", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_BASE_URL", "http://localhost:11434/v1");
    const config = loadExtractionConfig();
    expect(config.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("treats enabled=false correctly", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_ENABLED", "false");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });

  it("defaults enabled to false when env var missing", () => {
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });

  it("reads jsonMode=true from OPENMEMBRAIN_EXTRACTION_JSON_MODE", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_JSON_MODE", "true");
    const config = loadExtractionConfig();
    expect(config.jsonMode).toBe(true);
  });

  it("reads jsonMode=false from OPENMEMBRAIN_EXTRACTION_JSON_MODE", () => {
    vi.stubEnv("OPENMEMBRAIN_EXTRACTION_JSON_MODE", "false");
    const config = loadExtractionConfig();
    expect(config.jsonMode).toBe(false);
  });

  it("omits jsonMode when env var not set", () => {
    const config = loadExtractionConfig();
    expect(config).not.toHaveProperty("jsonMode");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/loadExtractionConfig.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/extraction/loadExtractionConfig.ts tests/unit/loadExtractionConfig.test.ts
git commit -m "feat: simplify loadExtractionConfig, remove OpenAI-specific env vars"
```

---

### Task 4: Update `tsconfig.json` path alias

**Files:**
- Modify: `tsconfig.json:20`

- [ ] **Step 1: Update the path alias**

Change:
```json
"@openmembrain/extractor-openai": ["packages/extractor-openai/src/index.ts"]
```
To:
```json
"@openmembrain/extractor-llm": ["packages/extractor-llm/src/index.ts"]
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: May still fail due to remaining old references — fixed in subsequent tasks.

---

### Task 5: Update `apps/mcp-server`

**Files:**
- Modify: `apps/mcp-server/src/context.ts:5,64`
- Modify: `apps/mcp-server/package.json:38,44`

- [ ] **Step 1: Update `apps/mcp-server/package.json`**

In `dependencies`, remove:
```json
"openai": "^6.37.0",
```

In `devDependencies`, change:
```json
"@openmembrain/extractor-openai": "*",
```
To:
```json
"@openmembrain/extractor-llm": "*",
```

- [ ] **Step 2: Update `apps/mcp-server/src/context.ts`**

Change import (line 5):
```ts
import { OpenAiMemoryExtractor } from "@openmembrain/extractor-openai";
```
To:
```ts
import { LlmMemoryExtractor } from "@openmembrain/extractor-llm";
```

Change provider registration (line 64):
```ts
openai: (config, opts) => new OpenAiMemoryExtractor(config, opts),
```
To:
```ts
llm: (config, opts) => new LlmMemoryExtractor(config, opts),
```

- [ ] **Step 3: Commit**

```bash
git add apps/mcp-server/src/context.ts apps/mcp-server/package.json
git commit -m "feat: wire LlmMemoryExtractor in MCP server"
```

---

### Task 6: Update `createExtractor` tests

**Files:**
- Modify: `tests/unit/createExtractor.test.ts`

- [ ] **Step 1: Update test file**

Replace the full content with:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createExtractor,
  MockMemoryExtractor,
  type ExtractionConfig,
  type MemoryExtractor,
  type OnExtractionDiagnostics,
} from "@openmembrain/core";
import { OpenMembrainError } from "@openmembrain/core";

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

  it("throws EXTRACTION_CONFIG_ERROR for anthropic without apiKey when enabled", () => {
    const config: ExtractionConfig = { provider: "anthropic", enabled: true };
    expect(() => createExtractor(config, { providers: fakeProviders })).toThrow(OpenMembrainError);
    try {
      createExtractor(config, { providers: fakeProviders });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenMembrainError);
      expect((err as OpenMembrainError).code).toBe("EXTRACTION_CONFIG_ERROR");
    }
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
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/createExtractor.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/createExtractor.test.ts
git commit -m "test: update createExtractor tests for llm provider"
```

---

### Task 7: Rename and update extractor test

**Files:**
- Delete: `tests/unit/OpenAiMemoryExtractor.test.ts`
- Create: `tests/unit/LlmMemoryExtractor.test.ts`

- [ ] **Step 1: Create `tests/unit/LlmMemoryExtractor.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { LlmMemoryExtractor } from "@openmembrain/extractor-llm";
import type { OnExtractionDiagnostics, ExtractionConfig } from "@openmembrain/core";

function createMockClient(responses: string[]) {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const content = responses[callIndex] ?? "[]";
          callIndex++;
          return {
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          };
        }),
      },
    },
  } as unknown as OpenAI;
}

const baseConfig: ExtractionConfig = {
  provider: "llm",
  enabled: true,
  model: "gpt-4o",
};

describe("LlmMemoryExtractor", () => {
  it("extracts candidates from a simple session transcript", async () => {
    const response = JSON.stringify({
      memories: [
        {
          content: "Use pnpm for package management",
          type: "project_fact",
          scope: "tooling",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "Mentioned in transcript",
          tags: ["tooling"],
        },
      ],
    });
    const client = createMockClient([response]);
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "We use pnpm for package management.",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Use pnpm for package management");
    expect(results[0]!.projectId).toBe("proj-1");
    expect(client.chat.completions.create).toHaveBeenCalledOnce();
  });

  it("returns empty array for empty session text", async () => {
    const client = createMockClient([]);
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "   ",
    });

    expect(results).toEqual([]);
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it("handles API errors gracefully", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error("API rate limit");
          }),
        },
      },
    } as unknown as OpenAI;
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content here",
    });

    expect(results).toEqual([]);
  });

  it("chunks long transcripts and merges results", async () => {
    const mem1 = JSON.stringify({
      memories: [
        {
          content: "Fact from chunk 1",
          type: "project_fact",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "Found in chunk 1",
          tags: [],
        },
      ],
    });
    const mem2 = JSON.stringify({
      memories: [
        {
          content: "Fact from chunk 2",
          type: "coding_rule",
          scope: "backend",
          confidence: "medium",
          sensitivity: "internal",
          recommendedAction: "ask_user",
          reason: "Found in chunk 2",
          tags: [],
        },
      ],
    });
    const client = createMockClient([mem1, mem2]);
    const extractor = new LlmMemoryExtractor(
      { ...baseConfig, maxChunkCharacters: 50 },
      { client },
    );

    const longText = "A".repeat(60) + "\n\n" + "B".repeat(60);
    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: longText,
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe("Fact from chunk 1");
    expect(results[1]!.content).toBe("Fact from chunk 2");
  });

  it("deduplicates across chunks", async () => {
    const sameMem = JSON.stringify({
      memories: [
        {
          content: "Use TypeScript strict mode",
          type: "coding_rule",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "Repeated",
          tags: [],
        },
      ],
    });
    const client = createMockClient([sameMem, sameMem]);
    const extractor = new LlmMemoryExtractor(
      { ...baseConfig, maxChunkCharacters: 50 },
      { client },
    );

    const longText = "A".repeat(60) + "\n\n" + "B".repeat(60);
    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: longText,
    });

    expect(results).toHaveLength(1);
  });

  it("calls onDiagnostics callback with token usage", async () => {
    const response = JSON.stringify({
      memories: [
        {
          content: "Some fact",
          type: "project_fact",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "test",
          tags: [],
        },
      ],
    });
    const client = createMockClient([response]);
    const onDiagnostics = vi.fn();
    const extractor = new LlmMemoryExtractor(baseConfig, {
      client,
      onDiagnostics,
    });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    expect(onDiagnostics).toHaveBeenCalledOnce();
    expect(onDiagnostics).toHaveBeenCalledWith({
      chunks: 1,
      totalPromptTokens: 100,
      totalCompletionTokens: 50,
      candidatesExtracted: 1,
      errors: [],
    });
  });

  it("works without apiKey for local models", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const config: ExtractionConfig = {
      provider: "llm",
      enabled: true,
      model: "llama3.1",
      baseUrl: "http://localhost:11434/v1",
    };
    const extractor = new LlmMemoryExtractor(config, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    expect(results).toEqual([]);
  });

  it("does not send response_format when jsonMode is false", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const config: ExtractionConfig = {
      ...baseConfig,
      jsonMode: false,
    };
    const extractor = new LlmMemoryExtractor(config, { client });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("response_format");
  });

  it("sends response_format when jsonMode is true (default)", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    await extractor.extract({
      projectId: "proj-1",
      transcript: "Some content",
    });

    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toHaveProperty("response_format", { type: "json_object" });
  });

  it("extracts JSON from markdown fences when jsonMode is off", async () => {
    const jsonContent = JSON.stringify({
      memories: [
        {
          content: "Use ESM modules",
          type: "project_fact",
          scope: "global",
          confidence: "high",
          sensitivity: "internal",
          recommendedAction: "auto_save",
          reason: "test",
          tags: [],
        },
      ],
    });
    const wrappedResponse = "Here is the extracted knowledge:\n```json\n" + jsonContent + "\n```";
    const client = createMockClient([wrappedResponse]);
    const config: ExtractionConfig = { ...baseConfig, jsonMode: false };
    const extractor = new LlmMemoryExtractor(config, { client });

    const results = await extractor.extract({
      projectId: "proj-1",
      transcript: "We use ESM modules.",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Use ESM modules");
  });

  it("uses both summary and transcript via getSessionText", async () => {
    const response = JSON.stringify({ memories: [] });
    const client = createMockClient([response]);
    const extractor = new LlmMemoryExtractor(baseConfig, { client });

    await extractor.extract({
      projectId: "proj-1",
      summary: "Summary text",
      transcript: "Transcript text",
    });

    expect(client.chat.completions.create).toHaveBeenCalledOnce();
    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as { messages: { content: string }[] };
    const userContent = call.messages[1]!.content;
    expect(userContent).toContain("Summary text");
    expect(userContent).toContain("Transcript text");
  });
});
```

- [ ] **Step 2: Delete the old test file**

```bash
git rm tests/unit/OpenAiMemoryExtractor.test.ts
```

- [ ] **Step 3: Run test**

Run: `npx vitest run tests/unit/LlmMemoryExtractor.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/LlmMemoryExtractor.test.ts
git commit -m "test: add LlmMemoryExtractor tests, remove old OpenAI-specific tests"
```

---

### Task 8: Delete old `packages/extractor-openai`

**Files:**
- Delete: `packages/extractor-openai/` (entire directory)

- [ ] **Step 1: Remove the directory**

```bash
git rm -r packages/extractor-openai
```

- [ ] **Step 2: Run `npm install` to update workspace links**

Run: `npm install`
Expected: Workspace resolution updates, no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove packages/extractor-openai (replaced by extractor-llm)"
```

---

### Task 9: Update `.opencode/INSTALL.md` references

**Files:**
- Modify: `.opencode/INSTALL.md` (line 70 references `OPENMEMBRAIN_OPENAI_API_KEY`)

- [ ] **Step 1: Update the env var reference**

Change `OPENMEMBRAIN_OPENAI_API_KEY` to `OPENMEMBRAIN_EXTRACTION_API_KEY` in the install instructions. Update the provider config example to use `"llm"` instead of `"openai"`.

- [ ] **Step 2: Commit**

```bash
git add .opencode/INSTALL.md
git commit -m "docs: update INSTALL.md for new extraction env vars"
```

---

### Task 10: Full verification

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Final commit if needed**

```bash
git status
```

If clean, done. If not, stage and commit remaining changes.

---

## Summary of Breaking Changes

| Before | After |
|--------|-------|
| `OPENMEMBRAIN_EXTRACTION_PROVIDER=openai` | `OPENMEMBRAIN_EXTRACTION_PROVIDER=llm` |
| `OPENMEMBRAIN_OPENAI_API_KEY` | Removed. Use `OPENMEMBRAIN_EXTRACTION_API_KEY` |
| `OPENMEMBRAIN_OPENAI_MODEL` | Removed. Use `OPENMEMBRAIN_EXTRACTION_MODEL` |
| `OPENMEMBRAIN_OPENAI_BASE_URL` | Removed. Use `OPENMEMBRAIN_EXTRACTION_BASE_URL` |
| `@openmembrain/extractor-openai` | `@openmembrain/extractor-llm` |
| `OpenAiMemoryExtractor` class | `LlmMemoryExtractor` class |
| Provider list: `["mock", "openai", "anthropic", "local"]` | `["mock", "llm", "anthropic"]` |
| `apiKey` required for `openai` provider | `apiKey` optional for `llm` provider |

## New Config: `OPENMEMBRAIN_EXTRACTION_JSON_MODE`

- Not set or `"true"` — sends `response_format: { type: "json_object" }` to the API
- `"false"` — omits `response_format`, extracts JSON from freeform response (needed for models that don't support JSON mode)

## Provider Examples After Implementation

```bash
# Local Ollama (free, no API key needed)
OPENMEMBRAIN_EXTRACTION_PROVIDER=llm
OPENMEMBRAIN_EXTRACTION_ENABLED=true
OPENMEMBRAIN_EXTRACTION_BASE_URL=http://localhost:11434/v1
OPENMEMBRAIN_EXTRACTION_MODEL=llama3.1
OPENMEMBRAIN_EXTRACTION_JSON_MODE=false

# Groq (fast, cheap)
OPENMEMBRAIN_EXTRACTION_PROVIDER=llm
OPENMEMBRAIN_EXTRACTION_ENABLED=true
OPENMEMBRAIN_EXTRACTION_API_KEY=gsk_...
OPENMEMBRAIN_EXTRACTION_BASE_URL=https://api.groq.com/openai/v1
OPENMEMBRAIN_EXTRACTION_MODEL=llama-3.1-70b-versatile

# OpenAI (still works, just use "llm" provider)
OPENMEMBRAIN_EXTRACTION_PROVIDER=llm
OPENMEMBRAIN_EXTRACTION_ENABLED=true
OPENMEMBRAIN_EXTRACTION_API_KEY=sk-...
OPENMEMBRAIN_EXTRACTION_MODEL=gpt-4o

# OpenRouter (access to many models)
OPENMEMBRAIN_EXTRACTION_PROVIDER=llm
OPENMEMBRAIN_EXTRACTION_ENABLED=true
OPENMEMBRAIN_EXTRACTION_API_KEY=sk-or-...
OPENMEMBRAIN_EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
OPENMEMBRAIN_EXTRACTION_MODEL=meta-llama/llama-3.1-70b-instruct
```

## Future Work (Ticket 2)

- Create `packages/extractor-anthropic` with `@anthropic-ai/sdk`
- Register `anthropic` provider factory in MCP server context
- Handle Anthropic message format conversion
