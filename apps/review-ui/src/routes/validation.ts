import { z } from "zod";

export const projectFields = { projectRoot: true, projectId: true, storageDir: true, storageBackend: true } as const;

export function queryInput(query: URLSearchParams, numeric: readonly string[] = []): Record<string, unknown> {
  return Object.fromEntries([...query].map(([key, value]) => [key, numeric.includes(key) ? Number(value) : value]));
}

export function bodyObject(body: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(body === undefined ? {} : body);
}
