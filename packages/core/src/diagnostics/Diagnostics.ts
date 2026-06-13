import type { OpenMembraneErrorCode } from "../errors/OpenMembraneError";

export const diagnosticSeverities = ["debug", "info", "warning", "error"] as const;
export type DiagnosticSeverity = (typeof diagnosticSeverities)[number];

export interface DiagnosticEvent {
  id: string;
  projectId: string;
  severity: DiagnosticSeverity;
  code: OpenMembraneErrorCode | string;
  message: string;
  operation?: string;
  source?: "core" | "storage" | "mcp-server" | "exporter" | "adapter";
  entityId?: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

export interface DiagnosticQuery {
  limit?: number;
  severity?: DiagnosticSeverity;
  code?: string;
}

export interface DiagnosticsLogStore {
  append(event: DiagnosticEvent): Promise<void>;
  list(projectId: string, query?: DiagnosticQuery): Promise<DiagnosticEvent[]>;
}
