export type OpenMembrainErrorCode =
  | "VALIDATION_ERROR"
  | "CANDIDATE_NOT_FOUND"
  | "SECRET_CANDIDATE"
  | "EXPORT_PATH_OUTSIDE_ROOT"
  | "STORAGE_INVALID_JSON"
  | "EXTRACTION_CONFIG_ERROR"
  | "EXTRACTION_PROVIDER_ERROR"
  | "UNKNOWN_ERROR";

export interface OpenMembrainErrorOptions {
  code: OpenMembrainErrorCode;
  message: string;
  safeMessage?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface SafeErrorPayload {
  code: OpenMembrainErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class OpenMembrainError extends Error {
  readonly code: OpenMembrainErrorCode;
  readonly safeMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(options: OpenMembrainErrorOptions) {
    super(options.message);
    this.name = "OpenMembrainError";
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

export function normalizeOpenMembrainError(error: unknown): OpenMembrainError {
  if (error instanceof OpenMembrainError) {
    return error;
  }

  if (error instanceof Error) {
    return new OpenMembrainError({
      code: "UNKNOWN_ERROR",
      message: error.message,
      safeMessage: "OpenMembrain hit an unexpected error while handling the request.",
      cause: error
    });
  }

  return new OpenMembrainError({
    code: "UNKNOWN_ERROR",
    message: String(error),
    safeMessage: "OpenMembrain hit an unexpected error while handling the request."
  });
}
