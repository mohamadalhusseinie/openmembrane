# Auto-Enable AI Extractor When API Key Present — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-enable the AI extractor when an API key environment variable is present, removing the double opt-in friction.

**Architecture:** Modify `loadExtractionConfig()` to implement new decision logic (API key present -> enabled + openai default). Log a startup diagnostic in `context.ts` when falling back to mock due to missing key. Update tests to reflect new defaults.

**Tech Stack:** TypeScript, Vitest, Node.js env vars

**Branch:** `issue-78` (already created)

---

## Decision Logic (from issue #78)

```
API key present + ENABLED not set     -> enabled: true, provider: "openai" (if no provider set)
API key present + ENABLED=true        -> enabled: true (explicit)
API key present + ENABLED=false       -> enabled: false (user override)
No API key + any ENABLED value        -> enabled: false, provider: "mock"
```

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/extraction/loadExtractionConfig.ts` | Modify | New decision logic |
| `apps/mcp-server/src/context.ts` | Modify | Log startup diagnostic when mock fallback |
| `tests/unit/loadExtractionConfig.test.ts` | Modify | Update + add tests |

---

### Task 1: Update `loadExtractionConfig.ts` with new decision logic

**Files:**
- Modify: `packages/core/src/extraction/loadExtractionConfig.ts`

- [ ] **Step 1: Replace the entire function body**

Replace the current content of `packages/core/src/extraction/loadExtractionConfig.ts` with:

```typescript
import { env } from "node:process";
import { type ExtractionConfig, type ExtractionProvider } from "./ExtractionConfig";

export function loadExtractionConfig(): ExtractionConfig {
  const apiKey = env.OPENMEMBRANE_EXTRACTION_API_KEY ?? env.OPENMEMBRANE_OPENAI_API_KEY;
  const model = env.OPENMEMBRANE_EXTRACTION_MODEL ?? env.OPENMEMBRANE_OPENAI_MODEL;
  const baseUrl = env.OPENMEMBRANE_EXTRACTION_BASE_URL ?? env.OPENMEMBRANE_OPENAI_BASE_URL;
  const explicitEnabled = env.OPENMEMBRANE_EXTRACTION_ENABLED;
  const explicitProvider = env.OPENMEMBRANE_EXTRACTION_PROVIDER as ExtractionProvider | undefined;

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
```

Key changes:
- Removed import of `defaultExtractionConfig` (no longer needed)
- API key check comes first — no key = always mock+disabled
- When key is present: `enabled` defaults to `true` unless `ENABLED=false`
- When key is present: `provider` defaults to `"openai"` unless explicit

- [ ] **Step 2: Run type-check**

Run: `npm run check`
Expected: No type errors

---

### Task 2: Add startup diagnostic in `context.ts`

**Files:**
- Modify: `apps/mcp-server/src/context.ts:59-66`

- [ ] **Step 1: Add diagnostic logging after config resolution**

In `apps/mcp-server/src/context.ts`, after line 58 (the `onDiagnostics` callback closing brace) and before line 60 (the `const pipeline = ...`), insert:

```typescript
  const extractionConfig = loadExtractionConfig();

  if (!extractionConfig.enabled || extractionConfig.provider === "mock") {
    void diagnosticsLogStore.append({
      id: createId("diag"),
      projectId: defaultProjectId,
      severity: "info",
      code: "EXTRACTION_MOCK_FALLBACK",
      message: "No extraction API key configured — using MockMemoryExtractor. Only explicitly prefixed text will be extracted.",
      operation: "startup",
      source: "core",
      createdAt: nowIso(),
    });
  }
```

Then update line 61 to use `extractionConfig` instead of calling `loadExtractionConfig()`:

Change:
```typescript
  const pipeline = new MemoryPipeline({
    extractor: createExtractor(loadExtractionConfig(), {
```

To:
```typescript
  const pipeline = new MemoryPipeline({
    extractor: createExtractor(extractionConfig, {
```

- [ ] **Step 2: Run type-check**

Run: `npm run check`
Expected: No type errors

---

### Task 3: Update existing test that will break

**Files:**
- Modify: `tests/unit/loadExtractionConfig.test.ts:18-22`

- [ ] **Step 1: Fix the "reads provider" test**

The test at line 18-22 sets `OPENMEMBRANE_EXTRACTION_PROVIDER=openai` but no API key. Under new logic, no API key -> always mock. Update it to also stub an API key:

Change:
```typescript
  it("reads provider from OPENMEMBRANE_EXTRACTION_PROVIDER", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "openai");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("openai");
  });
```

To:
```typescript
  it("reads provider from OPENMEMBRANE_EXTRACTION_PROVIDER", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", "sk-test");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("openai");
  });
```

- [ ] **Step 2: Run tests to verify fix**

Run: `npm test`
Expected: All existing tests pass

---

### Task 4: Add new tests for auto-enable behavior

**Files:**
- Modify: `tests/unit/loadExtractionConfig.test.ts` (append new tests)

- [ ] **Step 1: Add test — auto-enables when API key present and ENABLED not set**

```typescript
  it("auto-enables when API key is present and ENABLED not set", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", "sk-test-key");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(true);
  });
```

- [ ] **Step 2: Add test — defaults provider to openai when key present but no provider**

```typescript
  it("defaults provider to openai when API key is present but no provider specified", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", "sk-test-key");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("openai");
  });
```

- [ ] **Step 3: Add test — explicit ENABLED=false overrides auto-enable**

```typescript
  it("explicit ENABLED=false overrides auto-enable when API key is present", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", "sk-test-key");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "false");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(false);
  });
```

- [ ] **Step 4: Add test — no API key forces mock even with ENABLED=true**

```typescript
  it("forces mock fallback when no API key regardless of ENABLED value", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "true");
    const config = loadExtractionConfig();
    expect(config.provider).toBe("mock");
    expect(config.enabled).toBe(false);
  });
```

- [ ] **Step 5: Add test — no breaking change with all three vars set**

```typescript
  it("works unchanged when all three env vars are explicitly set", () => {
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_ENABLED", "true");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_PROVIDER", "openai");
    vi.stubEnv("OPENMEMBRANE_EXTRACTION_API_KEY", "sk-full");
    const config = loadExtractionConfig();
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("openai");
    expect(config.apiKey).toBe("sk-full");
  });
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

---

### Task 5: Final verification

- [ ] **Step 1: Run full check (typecheck + tests)**

Run: `npm run check`
Expected: PASS

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

---

### Task 6: Commit and create PR

- [ ] **Step 1: Stage and commit**

```bash
git add packages/core/src/extraction/loadExtractionConfig.ts apps/mcp-server/src/context.ts tests/unit/loadExtractionConfig.test.ts
git commit -m "feat: auto-enable AI extractor when API key is present (#78)"
```

- [ ] **Step 2: Push and create PR**

```bash
git push -u origin issue-78
gh pr create --title "feat: auto-enable AI extractor when API key is present" --body "..." --base main
```

PR body should include:
- Closes #78
- Summary of behavior change
- Decision logic table
