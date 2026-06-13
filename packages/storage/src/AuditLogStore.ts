import { join } from "node:path";
import type { AuditEvent, AuditLogStore } from "@openmembrane/core";
import { readJsonArray, writeJsonArray } from "./jsonFile";

export class JsonAuditLogStore implements AuditLogStore {
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "audit-log.json");
  }

  async append(event: AuditEvent): Promise<void> {
    const rows = await readJsonArray<AuditEvent>(this.filePath);
    rows.push(event);
    await writeJsonArray(this.filePath, rows);
  }

  async list(projectId: string): Promise<AuditEvent[]> {
    const rows = await readJsonArray<AuditEvent>(this.filePath);
    return rows.filter((event) => event.projectId === projectId);
  }
}
