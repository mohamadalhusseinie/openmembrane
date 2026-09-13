import { createHash } from "node:crypto";
import {
  SecretDetector,
  confidenceValues,
  memoryScopes,
  memoryStatuses,
  memoryTypes,
  sensitivityValues,
  type MemoryEntry,
  type SharedMemoryEntry,
} from "@openmembrane/core";

export const repositorySchemaVersion = 1;

export const projectFilePath = ".openmembrane/project.json";
export const manifestFilePath = ".openmembrane/manifest.json";

interface RepositoryProjectFile {
  schemaVersion: number;
  projectId: string;
  defaultBranch: string;
}

interface RepositoryManifestFile extends RepositoryProjectFile {
  generatedAt: string;
  memories: Array<{ id: string; contentHash: string }>;
}

export interface RepositoryFile {
  path: string;
  content: string;
}

export type ValidationResult<T> =
  | { kind: "valid"; value: T }
  | { kind: "quarantined"; reason: string };

export interface QuarantinedMemoryFile {
  path: string;
  reason: string;
}

export interface MemoryFilesValidationResult {
  valid: SharedMemoryEntry[];
  quarantined: QuarantinedMemoryFile[];
}

export interface FullRebuildComparison {
  unchanged: boolean;
  upsert: SharedMemoryEntry[];
  remove: string[];
  quarantined: Array<{ id: string; reason: string }>;
}

export function createProjectFile(input: Omit<RepositoryProjectFile, "schemaVersion">): RepositoryFile {
  return {
    path: projectFilePath,
    content: serialize({ schemaVersion: repositorySchemaVersion, ...input }),
  };
}

export function createMemoryFile(entry: MemoryEntry | SharedMemoryEntry): RepositoryFile {
  const shared = toSharedMemoryEntry(entry);
  assertSafeSharedMemoryEntry(shared);

  return {
    path: memoryFilePath(shared.id),
    content: serialize(shared),
  };
}

export function createManifestFile(input: {
  projectId: string;
  defaultBranch: string;
  memories: SharedMemoryEntry[];
  generatedAt: string;
}): RepositoryFile {
  const memories = input.memories
    .map((memory) => {
      assertSafeSharedMemoryEntry(memory);
      return { id: memory.id, contentHash: sharedMemoryContentHash(memory) };
    })
    .sort((first, second) => first.id.localeCompare(second.id));

  return {
    path: manifestFilePath,
    content: serialize({
      schemaVersion: repositorySchemaVersion,
      projectId: input.projectId,
      defaultBranch: input.defaultBranch,
      generatedAt: input.generatedAt,
      memories,
    }),
  };
}

export function validateProjectFile(content: string, projectId: string): ValidationResult<RepositoryProjectFile> {
  const parsed = parseObject(content, "Repository metadata is not valid JSON.");
  if (parsed.kind === "quarantined") {
    return parsed;
  }

  const value = parsed.value;
  if (!hasOnlyKeys(value, ["schemaVersion", "projectId", "defaultBranch"]) ||
    typeof value.schemaVersion !== "number" ||
    typeof value.projectId !== "string" ||
    typeof value.defaultBranch !== "string") {
    return { kind: "quarantined", reason: "Repository metadata has an invalid format." };
  }
  if (value.schemaVersion !== repositorySchemaVersion) {
    return { kind: "quarantined", reason: "Unsupported repository schema version." };
  }
  if (value.projectId !== projectId) {
    return { kind: "quarantined", reason: "Project ID does not match the configured project." };
  }

  return { kind: "valid", value: value as unknown as RepositoryProjectFile };
}

export function validateManifestFile(content: string, projectId: string): ValidationResult<RepositoryManifestFile> {
  const parsed = parseObject(content, "Manifest is not valid JSON.");
  if (parsed.kind === "quarantined") {
    return parsed;
  }

  const value = parsed.value;
  if (!hasOnlyKeys(value, ["schemaVersion", "projectId", "defaultBranch", "generatedAt", "memories"]) ||
    typeof value.schemaVersion !== "number" ||
    typeof value.projectId !== "string" ||
    typeof value.defaultBranch !== "string" ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.memories) ||
    !value.memories.every(isManifestMemory)) {
    return { kind: "quarantined", reason: "Manifest has an invalid format." };
  }
  if (value.schemaVersion !== repositorySchemaVersion) {
    return { kind: "quarantined", reason: "Unsupported repository schema version." };
  }
  if (value.projectId !== projectId) {
    return { kind: "quarantined", reason: "Project ID does not match the configured project." };
  }

  return { kind: "valid", value: value as unknown as RepositoryManifestFile };
}

export function validateMemoryFiles(
  files: readonly RepositoryFile[],
  projectId: string,
  secretDetector = new SecretDetector(),
): MemoryFilesValidationResult {
  const valid: SharedMemoryEntry[] = [];
  const quarantined: QuarantinedMemoryFile[] = [];

  for (const file of files) {
    const validation = validateMemoryFile(file, projectId, secretDetector);
    if (validation.kind === "valid") {
      valid.push(validation.value);
    } else {
      quarantined.push({ path: file.path, reason: validation.reason });
    }
  }

  return { valid, quarantined };
}

export function compareFullRebuild(
  current: readonly SharedMemoryEntry[],
  authoritative: readonly SharedMemoryEntry[],
): FullRebuildComparison {
  const currentById = new Map(current.map((memory) => [memory.id, memory]));
  const duplicateIds = duplicateMemoryIds(authoritative);
  const authoritativeById = new Map(
    authoritative
      .filter((memory) => !duplicateIds.has(memory.id))
      .map((memory) => [memory.id, memory]),
  );
  const upsert = [...authoritativeById.values()]
      .filter((memory) => sharedMemoryContentHash(currentById.get(memory.id)) !== sharedMemoryContentHash(memory))
    .sort((first, second) => first.id.localeCompare(second.id));
  const remove = [...currentById.keys()]
    .filter((id) => !authoritativeById.has(id) && !duplicateIds.has(id))
    .sort((first, second) => first.localeCompare(second));
  const quarantined = [...duplicateIds]
    .sort((first, second) => first.localeCompare(second))
    .map((id) => ({ id, reason: "Duplicate authoritative memory ID." }));

  return { unchanged: upsert.length === 0 && remove.length === 0, upsert, remove, quarantined };
}

function validateMemoryFile(
  file: RepositoryFile,
  projectId: string,
  secretDetector: SecretDetector,
): ValidationResult<SharedMemoryEntry> {
  const parsed = parseObject(file.content, "Remote record is not valid JSON.");
  if (parsed.kind === "quarantined") {
    return parsed;
  }
  if (secretDetector.containsSecret(file.content)) {
    return { kind: "quarantined", reason: "Remote record contains secret material." };
  }
  const entry = parsed.value;
  if (!isSharedMemoryEntry(entry)) {
    return { kind: "quarantined", reason: "Remote record has an invalid format." };
  }
  if (entry.projectId !== projectId) {
    return { kind: "quarantined", reason: "Project ID does not match the configured project." };
  }
  if (!memoryStatuses.includes(entry.status as (typeof memoryStatuses)[number])) {
    return { kind: "quarantined", reason: "Remote record has an unsupported status." };
  }
  if (file.path !== memoryFilePath(entry.id as string)) {
    return { kind: "quarantined", reason: "Remote record path does not match its memory ID." };
  }

  return { kind: "valid", value: entry as unknown as SharedMemoryEntry };
}

function toSharedMemoryEntry(entry: MemoryEntry | SharedMemoryEntry): SharedMemoryEntry {
  return sharedMemoryProjection(entry);
}

function assertSafeSharedMemoryEntry(entry: SharedMemoryEntry): void {
  const shared = sharedMemoryProjection(entry);
  const validation = validateMemoryFile(
    { path: memoryFilePath(shared.id), content: serialize(shared) },
    shared.projectId,
    new SecretDetector(),
  );
  if (validation.kind === "quarantined") {
    throw new Error(validation.reason);
  }
}

function memoryFilePath(id: string): string {
  return `.openmembrane/memories/${id}.json`;
}

function duplicateMemoryIds(memories: readonly SharedMemoryEntry[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const memory of memories) {
    if (seen.has(memory.id)) {
      duplicates.add(memory.id);
    }
    seen.add(memory.id);
  }
  return duplicates;
}

export function sharedMemoryContentHash(entry: SharedMemoryEntry | undefined): string {
  return createHash("sha256")
    .update(entry === undefined ? "" : serialize(sharedMemoryProjection(entry)))
    .digest("hex");
}

function sharedMemoryProjection(entry: MemoryEntry | SharedMemoryEntry): SharedMemoryEntry {
  return {
    id: entry.id,
    projectId: entry.projectId,
    type: entry.type,
    content: entry.content,
    scope: entry.scope,
    confidence: entry.confidence,
    sensitivity: entry.sensitivity,
    reason: entry.reason,
    tags: entry.tags,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.approvedAt === undefined ? {} : { approvedAt: entry.approvedAt }),
    ...(entry.supersededBy === undefined ? {} : { supersededBy: entry.supersededBy }),
    ...(entry.supersededAt === undefined ? {} : { supersededAt: entry.supersededAt }),
  };
}

function serialize(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseObject(content: string, malformedReason: string): ValidationResult<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { kind: "quarantined", reason: malformedReason };
    }
    return { kind: "valid", value: parsed as Record<string, unknown> };
  } catch {
    return { kind: "quarantined", reason: malformedReason };
  }
}

function isSharedMemoryEntry(value: Record<string, unknown>): boolean {
  return hasOnlyKeys(value, [
    "id", "projectId", "type", "content", "scope", "confidence", "sensitivity", "reason", "tags", "status", "createdAt", "updatedAt", "approvedAt", "supersededBy", "supersededAt",
  ]) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.type === "string" && memoryTypes.includes(value.type as (typeof memoryTypes)[number]) &&
    typeof value.content === "string" &&
    typeof value.scope === "string" && memoryScopes.includes(value.scope as (typeof memoryScopes)[number]) &&
    typeof value.confidence === "string" && confidenceValues.includes(value.confidence as (typeof confidenceValues)[number]) &&
    typeof value.sensitivity === "string" &&
    value.sensitivity !== "secret" && sensitivityValues.includes(value.sensitivity as (typeof sensitivityValues)[number]) &&
    typeof value.reason === "string" &&
    Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string") &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    optionalString(value.approvedAt) &&
    optionalString(value.supersededBy) &&
    optionalString(value.supersededAt);
}

function isManifestMemory(value: unknown): value is { id: string; contentHash: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const memory = value as Record<string, unknown>;
  return hasOnlyKeys(memory, ["id", "contentHash"]) &&
    typeof memory.id === "string" &&
    typeof memory.contentHash === "string" &&
    /^[a-f0-9]{64}$/.test(memory.contentHash);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
