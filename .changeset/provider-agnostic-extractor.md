---
"openmembrane": minor
---

Refactor extractor-openai into provider-agnostic extractor-llm for any OpenAI-compatible endpoint.

- Rename `@openmembrane/extractor-openai` to `@openmembrane/extractor-llm`
- Rename `OpenAiMemoryExtractor` to `LlmMemoryExtractor`
- Make `apiKey` optional for local models (Ollama, LM Studio, vLLM)
- Add `jsonMode` config flag to conditionally send `response_format`
- Add JSON extraction from freeform responses (markdown fences, surrounding text)
- Update provider list to `[mock, llm, anthropic]`
- Remove `OPENMEMBRANE_OPENAI_*` env var fallbacks
- Add `OPENMEMBRANE_EXTRACTION_JSON_MODE` env var support
