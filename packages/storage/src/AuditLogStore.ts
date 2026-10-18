import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { processedSessionFingerprint, type AuditEvent, type AuditLogStore } from "@openmembrane/core";
import { readJsonArray, readJsonObject, writeJsonArray, writeJsonObject } from "./jsonFile";

export class JsonAuditLogStore implements AuditLogStore {
  private readonly filePath: string;
  private readonly sessionIndexDir: string;
  private readonly sessionIndexReadyPath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "audit-log.json");
    this.sessionIndexDir = join(baseDir, "session-dispositions");
    this.sessionIndexReadyPath = join(this.sessionIndexDir, "ready.json");
  }

  async append(event: AuditEvent): Promise<void> {
    const fingerprint = processedSessionFingerprint(event);
    if (fingerprint) {
      await this.ensureSessionIndex();
      // A missing checkpoint forces recovery of interrupted audit/index writes.
      await rm(this.sessionIndexReadyPath, { force: true });
    }
    const rows = await readJsonArray<AuditEvent>(this.filePath);
    rows.push(event);
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeJsonArray(temporary, rows);
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    if (fingerprint) {
      await writeJsonObject(this.sessionIndexPath(event.projectId, fingerprint), {});
      await writeFile(this.sessionIndexReadyPath, "");
    }
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
    try {
      await readFile(this.sessionIndexReadyPath);
      return;
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    for (const event of await readJsonArray<AuditEvent>(this.filePath)) {
      const fingerprint = processedSessionFingerprint(event);
      if (fingerprint) await writeJsonObject(this.sessionIndexPath(event.projectId, fingerprint), {});
    }
    await mkdir(this.sessionIndexDir, { recursive: true });
    await writeFile(this.sessionIndexReadyPath, "");
  }

  async list(projectId: string): Promise<AuditEvent[]> {
    const rows = await readJsonArray<AuditEvent>(this.filePath);
    return rows.filter((event) => event.projectId === projectId);
  }
}
