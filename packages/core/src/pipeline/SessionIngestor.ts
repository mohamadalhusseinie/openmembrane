import { createHash } from "node:crypto";
import { nowIso } from "@openmembrane/shared";
import { SecretDetector, type SecretFinding } from "../filtering/SecretDetector";
import type { SessionInput } from "../types/SessionInput";

export interface IngestedSession {
  input: SessionInput;
  redactions: SecretFinding[];
  transcriptHash?: string;
}

export class SessionIngestor {
  constructor(private readonly secretDetector = new SecretDetector()) {}

  ingest(input: SessionInput): IngestedSession {
    const redactions: SecretFinding[] = [];
    const redactedInput: SessionInput = {
      ...input,
      createdAt: input.createdAt ?? nowIso()
    };

    if (input.transcript) {
      const result = this.secretDetector.redact(input.transcript);
      redactedInput.transcript = result.redactedText;
      redactions.push(...result.findings);
    }

    if (input.summary) {
      const result = this.secretDetector.redact(input.summary);
      redactedInput.summary = result.redactedText;
      redactions.push(...result.findings);
    }

    const rawText = [input.summary, input.transcript].filter(Boolean).join("\n\n");
    const transcriptHash = rawText ? createHash("sha256").update(rawText).digest("hex") : undefined;

    const ingested: IngestedSession = {
      input: redactedInput,
      redactions
    };

    if (transcriptHash) {
      ingested.transcriptHash = transcriptHash;
    }

    return ingested;
  }
}
