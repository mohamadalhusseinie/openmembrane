import { SecretDetector } from "../filtering/SecretDetector";
import type { MemoryCandidate, Sensitivity } from "../types/MemoryCandidate";

export class MemoryClassifier {
  constructor(private readonly secretDetector = new SecretDetector()) {}

  classify(candidate: MemoryCandidate): MemoryCandidate {
    return {
      ...candidate,
      sensitivity: this.classifySensitivity(candidate),
      tags: this.normalizeTags(candidate.tags)
    };
  }

  private normalizeTags(tags: string[]): string[] {
    const safe = tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag && !this.secretDetector.containsSecretInAnyCase(tag));
    return [...new Set(safe)];
  }

  private classifySensitivity(candidate: MemoryCandidate): Sensitivity {
    if (this.secretDetector.containsSecret(candidate.content)) {
      return "secret";
    }

    if (/\b(customer|personal data|pii|credential|password|token|secret|private key)\b/i.test(candidate.content)) {
      return "confidential";
    }

    if (candidate.type === "security_rule" || candidate.scope === "security") {
      return "confidential";
    }

    if (/\b(open source|public api|public docs)\b/i.test(candidate.content)) {
      return "public";
    }

    return candidate.sensitivity;
  }
}
