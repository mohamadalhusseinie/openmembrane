import { createHash } from "node:crypto";
import { join } from "node:path";
import { processedSessionFingerprint, type AuditEvent, type AuditLogStore } from "@openmembrane/core";
import { readJsonArray, readJsonObject, writeJsonArray, writeJsonObject } from "./jsonFile";

export class JsonAuditLogStore implements AuditLogStore {
  private readonly filePath: string;
  private readonly sessionIndexDir: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "audit-log.json");
    this.sessionIndexDir = join(baseDir, "session-dispositions");
  }

  async append(event: AuditEvent): Promise<void> {
    const fingerprint = processedSessionFingerprint(event);
    if (fingerprint) await this.ensureSessionIndex();
    const rows = await readJsonArray<AuditEvent>(this.filePath);
    rows.push(event);
    await writeJsonArray(this.filePath, rows);
    if (fingerprint) await writeJsonObject(this.sessionIndexPath(event.projectId, fingerprint), {});
  }

  async findProcessedSessionFingerprints(projectId: string, fingerprints: string[]): Promise<string[]> {
    if (fingerprints.length === 0) return [];
    await this.ensureSessionIndex();
    const found: string[] = [];
    for (const fingerprint of new Set(fingerprints)) {
      if (await readJsonObject(this.sessionIndexPath(projectId, fingerprint))) found.push(fingerprint);
    }
    return found;
  }

  private sessionIndexPath(projectId: string, fingerprint: string): string {
    const key = createHash("sha256").update(JSON.stringify([projectId, fingerprint])).digest("hex");
    return join(this.sessionIndexDir, `${key}.json`);
  }

  private async ensureSessionIndex(): Promise<void> {
    const ready = join(this.sessionIndexDir, "ready.json");
    if (await readJsonObject(ready)) return;
    for (const event of await readJsonArray<AuditEvent>(this.filePath)) {
      const fingerprint = processedSessionFingerprint(event);
      if (fingerprint) await writeJsonObject(this.sessionIndexPath(event.projectId, fingerprint), {});
    }
    await writeJsonObject(ready, {});
  }

  async list(projectId: string): Promise<AuditEvent[]> {
    const rows = await readJsonArray<AuditEvent>(this.filePath);
    return rows.filter((event) => event.projectId === projectId);
  }
}
