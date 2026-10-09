export const E_DAEMON_NOT_RUNNING = "E_DAEMON_NOT_RUNNING";

export class OpenMembraneClientError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly diagnosticId?: string;
  readonly origin: "client" | "daemon";

  constructor(code: string, safeMessage: string, options: { cause?: unknown; diagnosticId?: string; origin?: "client" | "daemon" } = {}) {
    super(safeMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenMembraneClientError";
    this.code = code;
    this.safeMessage = safeMessage;
    this.origin = options.origin ?? "client";
    if (options.diagnosticId !== undefined) this.diagnosticId = options.diagnosticId;
  }
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function daemonUnavailable(cause: unknown): OpenMembraneClientError {
  return new OpenMembraneClientError(E_DAEMON_NOT_RUNNING, "The OpenMembrane daemon is not running.", { cause });
}
