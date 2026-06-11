---
"openmembrain": minor
---

Refactor extractor-openai into provider-agnostic extractor-llm for any OpenAI-compatible endpoint.

- Rename `@openmembrain/extractor-openai` to `@openmembrain/extractor-llm`
- Rename `OpenAiMemoryExtractor` to `LlmMemoryExtractor`
- Make `apiKey` optional for local models (Ollama, LM Studio, vLLM)
- Add `jsonMode` config flag to conditionally send `response_format`
- Add JSON extraction from freeform responses (markdown fences, surrounding text)
- Update provider list to `[mock, llm, anthropic]`
- Remove `OPENMEMBRAIN_OPENAI_*` env var fallbacks
- Add `OPENMEMBRAIN_EXTRACTION_JSON_MODE` env var support
