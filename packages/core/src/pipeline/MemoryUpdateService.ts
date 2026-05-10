import { createId, nowIso } from "@openmembrain/shared";
import { OpenMembrainError } from "../errors/OpenMembrainError";
import { SecretDetector } from "../filtering/SecretDetector";
import { PolicyEngine } from "../policy/PolicyEngine";
import type { MemoryScope, MemoryType, Sensitivity } from "../types/MemoryCandidate";
import { sensitivityRank } from "../types/MemoryCandidate";
import type { MemoryEntry } from "../types/MemoryEntry";
import type { AuditLogStore, MemoryStore } from "../types/Storage";

export interface MemoryUpdateFields {
  content?: string | undefined;
  type?: MemoryType | undefined;
  scope?: MemoryScope | undefined;
  tags?: string[] | undefined;
}

export interface MemoryUpdateServiceOptions {
  memoryStore: MemoryStore;
  auditLogStore: AuditLogStore;
  secretDetector?: SecretDetector;
  policyEngine?: PolicyEngine;
}

export class MemoryUpdateService {
  private readonly memoryStore: MemoryStore;
  private readonly auditLogStore: AuditLogStore;
  private readonly secretDetector: SecretDetector;
  private readonly policyEngine: PolicyEngine;

  constructor(options: MemoryUpdateServiceOptions) {
    this.memoryStore = options.memoryStore;
    this.auditLogStore = options.auditLogStore;
    this.secretDetector = options.secretDetector ?? new SecretDetector();
    this.policyEngine = options.policyEngine ?? new PolicyEngine();
  }

  async update(projectId: string, memoryId: string, fields: MemoryUpdateFields): Promise<MemoryEntry> {
    const existing = await this.memoryStore.findById(projectId, memoryId);
    if (!existing) {
      throw new OpenMembrainError({
        code: "MEMORY_NOT_FOUND",
        message: `Memory ${memoryId} was not found.`,
        safeMessage: "The memory was not found.",
        details: { memoryId }
      });
    }

    if (existing.status === "superseded") {
      throw new OpenMembrainError({
        code: "MEMORY_ALREADY_SUPERSEDED",
        message: `Memory ${memoryId} is superseded and cannot be updated.`,
        safeMessage: "Superseded memories cannot be updated.",
        details: { memoryId }
      });
    }

    const newContent = fields.content ?? existing.content;

    if (fields.content !== undefined && this.secretDetector.containsSecret(newContent)) {
      throw new OpenMembrainError({
        code: "VALIDATION_ERROR",
        message: "Updated content contains secrets.",
        safeMessage: "The updated memory content contains secret material and cannot be saved.",
        details: { memoryId }
      });
    }

    if (fields.tags !== undefined) {
      const tagText = fields.tags.join(" ");
      if (tagText.length > 0 && this.secretDetector.containsSecret(tagText)) {
        throw new OpenMembrainError({
          code: "VALIDATION_ERROR",
          message: "Updated tags contain secrets.",
          safeMessage: "The updated tags contain secret material and cannot be saved.",
          details: { memoryId }
        });
      }
    }

    let newSensitivity: Exclude<Sensitivity, "secret"> = existing.sensitivity;

    if (fields.content !== undefined) {
      const syntheticCandidate = {
        id: existing.id,
        projectId,
        type: fields.type ?? existing.type,
        content: newContent,
        scope: fields.scope ?? existing.scope,
        confidence: existing.confidence,
        sensitivity: existing.sensitivity as Sensitivity,
        source: existing.source,
        reason: existing.reason,
        recommendedAction: "ask_user" as const,
        tags: fields.tags ?? existing.tags,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt
      };

      const check = this.policyEngine.evaluate(syntheticCandidate);
      if (!check.allowed) {
        throw new OpenMembrainError({
          code: "VALIDATION_ERROR",
          message: `Updated content violates policy: ${check.violations.join("; ")}`,
          safeMessage: "The updated memory content does not pass policy validation.",
          details: { memoryId, violations: check.violations }
        });
      }

      if (sensitivityRank(check.sensitivity) > sensitivityRank(existing.sensitivity)) {
        if (check.sensitivity === "secret") {
          throw new OpenMembrainError({
            code: "VALIDATION_ERROR",
            message: "Updated content was classified as secret.",
            safeMessage: "The updated memory content contains secret material and cannot be saved.",
            details: { memoryId }
          });
        }
        newSensitivity = check.sensitivity as Exclude<Sensitivity, "secret">;
      }
    }

    const previousSnapshot: Record<string, unknown> = {};
    if (fields.content !== undefined) previousSnapshot.previousContent = existing.content;
    if (fields.type !== undefined) previousSnapshot.previousType = existing.type;
    if (fields.scope !== undefined) previousSnapshot.previousScope = existing.scope;
    if (fields.tags !== undefined) previousSnapshot.previousTags = existing.tags;
    if (newSensitivity !== existing.sensitivity) previousSnapshot.previousSensitivity = existing.sensitivity;

    const now = nowIso();
    const updated: MemoryEntry = {
      ...existing,
      content: newContent,
      type: fields.type ?? existing.type,
      scope: fields.scope ?? existing.scope,
      tags: fields.tags ?? existing.tags,
      sensitivity: newSensitivity,
      updatedAt: now
    };

    await this.memoryStore.save(updated);
    await this.auditLogStore.append({
      id: createId("audit"),
      projectId,
      type: "memory_updated",
      entityId: memoryId,
      createdAt: now,
      details: previousSnapshot
    });

    return updated;
  }
}
