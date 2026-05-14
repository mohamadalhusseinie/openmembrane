export interface ExtractionChunkError {
  chunk: number;
  message: string;
}

export interface ExtractionDiagnostics {
  chunks: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  candidatesExtracted: number;
  errors: ExtractionChunkError[];
}

export type OnExtractionDiagnostics = (
  diagnostics: ExtractionDiagnostics,
) => void;
