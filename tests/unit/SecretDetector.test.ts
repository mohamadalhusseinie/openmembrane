import { describe, expect, it } from "vitest";
import { SecretDetector } from "@openmembrane/core";

const detector = new SecretDetector();

describe("SecretDetector", () => {
  describe("scan — individual patterns", () => {
    it("detects RSA private keys", () => {
      const text = "key: -----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("private_key");
    });

    it("detects EC private keys", () => {
      const text = "-----BEGIN EC PRIVATE KEY-----\ndata\n-----END EC PRIVATE KEY-----";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("private_key");
    });

    it("detects OPENSSH private keys", () => {
      const text = "-----BEGIN OPENSSH PRIVATE KEY-----\ndata\n-----END OPENSSH PRIVATE KEY-----";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("private_key");
    });

    it("detects generic private keys without prefix", () => {
      const text = "-----BEGIN PRIVATE KEY-----\ndata\n-----END PRIVATE KEY-----";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("private_key");
    });

    it("detects AWS access keys", () => {
      const text = "aws key: AKIAIOSFODNN7EXAMPLE";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("aws_access_key");
    });

    it("detects GitHub tokens (ghp)", () => {
      const text = "gh: ghp_ABCDEFGHIJKLMNOPQRSTuvwx";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("github_token");
    });

    it("detects GitHub tokens (gho, ghs, ghu, ghr)", () => {
      for (const prefix of ["gho", "ghs", "ghu", "ghr"]) {
        const text = `gh: ${prefix}_ABCDEFGHIJKLMNOPQRSTuvwx`;
        const findings = detector.scan(text);
        expect(findings).toHaveLength(1);
        expect(findings[0]!.type).toBe("github_token");
      }
    });

    it("detects OpenAI API keys (sk-)", () => {
      const text = "OPENAI_KEY=sk-abcdefghijklmnopqr";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("openai_api_key");
    });

    it("detects OpenAI project keys (sk-proj-)", () => {
      const text = "key: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("openai_api_key");
    });

    it("detects JWTs", () => {
      const text = "auth: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("jwt");
    });

    it("detects PostgreSQL database URLs", () => {
      const text = "DATABASE_URL=postgresql://user:pass@host:5432/db";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("database_url");
    });

    it("detects MySQL database URLs", () => {
      const text = "url: mysql://root:secret@localhost/mydb";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("database_url");
    });

    it("detects MongoDB+SRV database URLs", () => {
      const text = "MONGO=mongodb+srv://user:pass@cluster.mongodb.net/db";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("database_url");
    });

    it("detects Redis database URLs", () => {
      const text = "REDIS=redis://default:password@redis-host:6379";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("database_url");
    });

    it("detects env secrets with api_key", () => {
      const text = 'api_key = "my-secret-value-12345678"';
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("env_secret");
    });

    it("detects env secrets with client_secret", () => {
      const text = "client_secret: supersecretvalue123";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("env_secret");
    });

    it("detects env secrets with password", () => {
      const text = "password=longpassword12345678";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.type).toBe("env_secret");
    });
  });

  describe("scan — multiple secrets", () => {
    it("detects multiple different secrets in one string", () => {
      const text = "aws: AKIAIOSFODNN7EXAMPLE and key: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(2);
      expect(findings.map((f) => f.type)).toContain("aws_access_key");
      expect(findings.map((f) => f.type)).toContain("openai_api_key");
    });

    it("returns findings sorted by start position", () => {
      const text = "first: sk-abcdefghijklmnopqr then: AKIAIOSFODNN7EXAMPLE";
      const findings = detector.scan(text);
      expect(findings).toHaveLength(2);
      expect(findings[0]!.start).toBeLessThan(findings[1]!.start);
    });
  });

  describe("scan — overlapping match ranges", () => {
    it("skips overlapping findings", () => {
      const text = "api_key=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
      const findings = detector.scan(text);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      for (const f of findings) {
        expect(f.start).toBeLessThan(f.end);
      }
    });
  });

  describe("containsSecret", () => {
    it("returns true when text contains a secret", () => {
      expect(detector.containsSecret("key: AKIAIOSFODNN7EXAMPLE")).toBe(true);
    });

    it("returns false for clean text", () => {
      expect(detector.containsSecret("This project uses React.")).toBe(false);
    });

    it("returns true for already-redacted text with REDACTED marker", () => {
      expect(detector.containsSecret("The key was [REDACTED:openai_api_key] here.")).toBe(true);
    });

    it("returns true for any REDACTED marker type", () => {
      expect(detector.containsSecret("[REDACTED:custom_type]")).toBe(true);
    });
  });

  describe("redact", () => {
    it("returns original text unchanged when no secrets found", () => {
      const text = "This project uses Angular standalone components.";
      const result = detector.redact(text);
      expect(result.redactedText).toBe(text);
      expect(result.findings).toHaveLength(0);
    });

    it("replaces secret with REDACTED marker", () => {
      const text = "Key is AKIAIOSFODNN7EXAMPLE here.";
      const result = detector.redact(text);
      expect(result.redactedText).toBe("Key is [REDACTED:aws_access_key] here.");
      expect(result.findings).toHaveLength(1);
    });

    it("preserves surrounding text", () => {
      const text = "before AKIAIOSFODNN7EXAMPLE after";
      const result = detector.redact(text);
      expect(result.redactedText).toMatch(/^before \[REDACTED:aws_access_key\] after$/);
    });

    it("redacts multiple secrets in one string", () => {
      const text = "aws: AKIAIOSFODNN7EXAMPLE and openai: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
      const result = detector.redact(text);
      expect(result.redactedText).toContain("[REDACTED:aws_access_key]");
      expect(result.redactedText).toContain("[REDACTED:openai_api_key]");
      expect(result.redactedText).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.redactedText).not.toContain("sk-proj-");
    });
  });
});
