import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OpenMembraneError } from "@openmembrane/core";

export async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw invalidJsonError(filePath);
    }
    return parsed as T[];
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    if (error instanceof SyntaxError) {
      throw invalidJsonError(filePath, error);
    }
    throw error;
  }
}

export async function writeJsonArray<T>(filePath: string, rows: T[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

export async function readJsonObject<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalidJsonError(filePath, undefined, "object");
    }
    return parsed as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      throw invalidJsonError(filePath, error, "object");
    }
    throw error;
  }
}

export async function writeJsonObject<T>(filePath: string, data: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function invalidJsonError(filePath: string, cause?: unknown, kind: "array" | "object" = "array"): OpenMembraneError {
  return new OpenMembraneError({
    code: "STORAGE_INVALID_JSON",
    message: `Expected JSON ${kind} in ${filePath}.`,
    safeMessage: "OpenMembrane could not read one of its local JSON store files.",
    details: { filePath },
    cause
  });
}
