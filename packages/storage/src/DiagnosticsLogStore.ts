import { join } from "node:path";
import type { DiagnosticEvent, DiagnosticQuery, DiagnosticsLogStore } from "@openmembrane/core";
import { readJsonArray, writeJsonArray } from "./jsonFile";

export class JsonDiagnosticsLogStore implements DiagnosticsLogStore {
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "diagnostics-log.json");
  }

  async append(event: DiagnosticEvent): Promise<void> {
    const rows = await readJsonArray<DiagnosticEvent>(this.filePath);
    rows.push(event);
    await writeJsonArray(this.filePath, rows);
  }

  async list(projectId: string, query: DiagnosticQuery = {}): Promise<DiagnosticEvent[]> {
    const rows = await readJsonArray<DiagnosticEvent>(this.filePath);
    return rows
      .filter((event) => event.projectId === projectId)
      .filter((event) => (query.severity ? event.severity === query.severity : true))
      .filter((event) => (query.code ? event.code === query.code : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, query.limit ?? 100);
  }
}
