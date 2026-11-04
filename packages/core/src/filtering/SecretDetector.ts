export interface SecretFinding {
  type: string;
  match: string;
  start: number;
  end: number;
}

export interface RedactionResult {
  redactedText: string;
  findings: SecretFinding[];
}

const secretPatterns: Array<{ type: string; pattern: RegExp }> = [
  {
    type: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi
  },
  { type: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { type: "openai_api_key", pattern: /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/g },
  {
    type: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
  },
  {
    type: "database_url",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`<>]+/gi
  },
  {
    type: "env_secret",
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?token)\b\s*[:=]\s*["']?[^"'\s]{8,}/gi
  }
];

export class SecretDetector {
  scan(text: string): SecretFinding[] {
    const findings: SecretFinding[] = [];

    for (const { type, pattern } of secretPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      for (const match of text.matchAll(regex)) {
        if (match.index === undefined || !match[0]) {
          continue;
        }
        findings.push({
          type,
          match: match[0],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    return findings.sort((a, b) => a.start - b.start);
  }

  containsSecret(text: string): boolean {
    return this.scan(text).length > 0 || /\[REDACTED:[^\]]+\]/.test(text);
  }

  /** For values that may have been case-folded, which hides case-sensitive patterns such as AWS keys. */
  containsSecretInAnyCase(text: string): boolean {
    return (
      this.containsSecret(text) ||
      secretPatterns.some(({ pattern }) => new RegExp(pattern.source, pattern.flags.replace("g", "") + (pattern.flags.includes("i") ? "" : "i")).test(text))
    );
  }

  redact(text: string): RedactionResult {
    const findings = this.scan(text);
    if (findings.length === 0) {
      return { redactedText: text, findings };
    }

    const parts: string[] = [];
    let cursor = 0;

    for (const finding of findings) {
      if (finding.start < cursor) {
        continue;
      }
      parts.push(text.slice(cursor, finding.start));
      parts.push(`[REDACTED:${finding.type}]`);
      cursor = finding.end;
    }

    parts.push(text.slice(cursor));
    return {
      redactedText: parts.join(""),
      findings
    };
  }
}
