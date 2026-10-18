import { SecretDetector } from "../filtering/SecretDetector";
import { MAX_TRANSCRIPT_LENGTH } from "./IngestionRequest";

export function prepareTranscriptChunks(transcript: string): string[] {
  // Redact before transport boundaries can separate a secret from its delimiters.
  const { redactedText } = new SecretDetector().redact(transcript);
  const chunks: string[] = [];
  for (let start = 0; start < redactedText.length;) {
    let end = Math.min(start + MAX_TRANSCRIPT_LENGTH, redactedText.length);
    if (end < redactedText.length) {
      const newline = redactedText.lastIndexOf("\n", end - 1);
      if (newline > start + MAX_TRANSCRIPT_LENGTH / 2) end = newline + 1;
      else if (/[\uD800-\uDBFF]/.test(redactedText.charAt(end - 1))) end--;
    }
    chunks.push(redactedText.slice(start, end));
    start = end;
  }
  return chunks;
}
