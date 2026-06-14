export type OpenMembraneErrorCode =
  | "VALIDATION_ERROR"
  | "CANDIDATE_NOT_FOUND"
  | "SECRET_CANDIDATE"
  | "EXPORT_PATH_OUTSIDE_ROOT"
  | "STORAGE_INVALID_JSON"
  | "EXTRACTION_CONFIG_ERROR"
  | "EXTRACTION_PROVIDER_ERROR"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_ALREADY_SUPERSEDED"
  | "SENSITIVITY_DOWNGRADE"
  | "STORAGE_ERROR"
  | "UNKNOWN_ERROR";

export interface OpenMembraneErrorOptions {
  code: OpenMembraneErrorCode;
  message: string;
  safeMessage?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface SafeErrorPayload {
  code: OpenMembraneErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class OpenMembraneError extends Error {
  readonly code: OpenMembraneErrorCode;
  readonly safeMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(options: OpenMembraneErrorOptions) {
    super(options.message);
    this.name = "OpenMembraneError";
    this.code = options.code;
    this.safeMessage = options.safeMessage ?? options.message;
    if (options.details) {
      this.details = options.details;
    }

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  toSafePayload(): SafeErrorPayload {
    const payload: SafeErrorPayload = {
      code: this.code,
      message: this.safeMessage
    };

    if (this.details) {
      payload.details = this.details;
    }

    return payload;
  }
}

export function normalizeOpenMembraneError(error: unknown): OpenMembraneError {
  if (error instanceof OpenMembraneError) {
    return error;
  }

  if (error instanceof Error) {
    return new OpenMembraneError({
      code: "UNKNOWN_ERROR",
      message: error.message,
      safeMessage: "OpenMembrane hit an unexpected error while handling the request.",
      cause: error
    });
  }

  return new OpenMembraneError({
    code: "UNKNOWN_ERROR",
    message: String(error),
    safeMessage: "OpenMembrane hit an unexpected error while handling the request."
  });
}
