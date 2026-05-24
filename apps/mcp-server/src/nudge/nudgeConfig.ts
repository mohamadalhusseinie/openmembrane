import { env } from "node:process";

export interface NudgeConfig {
  readonly enabled: boolean;
  readonly threshold: number;
  readonly escalation: number;
  readonly reNudgeAfter: number;
}

export function loadNudgeConfig(): NudgeConfig {
  return {
    enabled: env.OPENMEMBRAIN_NUDGE_ENABLED !== "false",
    threshold: parsePositiveInt(env.OPENMEMBRAIN_NUDGE_THRESHOLD, 3),
    escalation: parsePositiveInt(env.OPENMEMBRAIN_NUDGE_ESCALATION, 3),
    reNudgeAfter: 5
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
