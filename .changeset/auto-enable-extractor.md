---
"openmembrane": minor
---

Auto-enable AI extractor when API key environment variable is present. Previously, users had to set both `OPENMEMBRANE_EXTRACTION_ENABLED=true` and `OPENMEMBRANE_EXTRACTION_PROVIDER=openai` alongside the API key. Now, the presence of an API key alone is sufficient to enable the real extractor. Explicit `ENABLED=false` still overrides. A startup diagnostic is logged when falling back to mock extraction.
