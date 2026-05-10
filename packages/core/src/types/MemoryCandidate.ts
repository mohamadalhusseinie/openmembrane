export const memoryTypes = [
  "project_fact",
  "coding_rule",
  "architecture_decision",
  "known_gotcha",
  "testing_rule",
  "deployment_rule",
  "security_rule",
  "forbidden_pattern",
  "domain_knowledge",
  "session_summary"
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export const recommendedActions = ["auto_save", "ask_user", "reject"] as const;
export type RecommendedAction = (typeof recommendedActions)[number];

export const sensitivityValues = ["public", "internal", "confidential", "secret"] as const;
export type Sensitivity = (typeof sensitivityValues)[number];

export function sensitivityRank(s: Sensitivity): number {
  return sensitivityValues.indexOf(s);
}

export const confidenceValues = ["low", "medium", "high"] as const;
export type Confidence = (typeof confidenceValues)[number];

export const memoryScopes = [
  "global",
  "frontend",
  "backend",
  "database",
  "deployment",
  "testing",
  "security",
  "tooling",
  "unknown"
] as const;

export type MemoryScope = (typeof memoryScopes)[number];

export interface MemorySource {
  kind: "session" | "manual" | "import" | "system";
  sessionId?: string;
  tool?: string;
  excerpt?: string;
  transcriptHash?: string;
}

export interface MemoryCandidate {
  id: string;
  projectId: string;
  type: MemoryType;
  content: string;
  scope: MemoryScope;
  confidence: Confidence;
  sensitivity: Sensitivity;
  source: MemorySource;
  reason: string;
  recommendedAction: RecommendedAction;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  duplicateOf?: string;
  conflictWith?: string[];
}
