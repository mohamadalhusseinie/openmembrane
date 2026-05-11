import { OpenMembrainError } from "../errors/OpenMembrainError";

export const MAX_TRANSCRIPT_LENGTH = 100_000;
export const MAX_SUMMARY_LENGTH = 10_000;

export interface IngestionRequest {
  projectId: string;
  transcript?: string;
  summary?: string;
  tool?: string;
  sessionId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export function validateIngestionRequest(request: IngestionRequest): void {
  if (!request.projectId.trim()) {
    throw new OpenMembrainError({
      code: "VALIDATION_ERROR",
      message: "projectId must not be empty or whitespace-only.",
      safeMessage: "A valid project ID is required."
    });
  }

  if (!request.transcript && !request.summary) {
    throw new OpenMembrainError({
      code: "VALIDATION_ERROR",
      message: "Either transcript or summary is required.",
      safeMessage: "Either a session transcript or summary is required."
    });
  }

  if (request.transcript && request.transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new OpenMembrainError({
      code: "VALIDATION_ERROR",
      message: `Transcript exceeds maximum length of ${MAX_TRANSCRIPT_LENGTH} characters.`,
      safeMessage: `Transcript exceeds maximum length of ${MAX_TRANSCRIPT_LENGTH} characters.`
    });
  }

  if (request.summary && request.summary.length > MAX_SUMMARY_LENGTH) {
    throw new OpenMembrainError({
      code: "VALIDATION_ERROR",
      message: `Summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters.`,
      safeMessage: `Summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters.`
    });
  }
}
