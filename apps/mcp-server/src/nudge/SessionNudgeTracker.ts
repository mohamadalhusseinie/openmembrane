import type { NudgeConfig } from "./nudgeConfig";

const SAVE_OPERATIONS = new Set(["remember", "propose_memory_from_session"]);

const LEVEL_0_MESSAGE =
  "If you have durable knowledge from previous work on this project (decisions made, rules discovered, gotchas encountered), call the remember tool now before starting new work.";

const LEVEL_1_MESSAGE =
  "Reminder: No memories saved this session. If you've learned something worth remembering, call remember({ content, type }).";

const LEVEL_2_TEMPLATE =
  "You have made {count} tool calls without saving any memories. If this session has produced durable knowledge (rules, decisions, gotchas), call remember({ content: \"...\", type: \"...\" }) now.";

const LEVEL_3_TEMPLATE =
  "IMPORTANT: This session has produced no memories after {count} interactions. Please call remember with any durable knowledge before this context is lost. Example: remember({ content: \"The API uses PKCE for OAuth\", type: \"architecture_decision\" })";

export class SessionNudgeTracker {
  private readonly config: NudgeConfig;
  private toolCallCount = 0;
  private memorySavedThisSession = false;
  private callsSinceLastSave = 0;
  private firstToolCallAt: string | undefined = undefined;

  constructor(config: NudgeConfig) {
    this.config = config;
  }

  /**
   * Record a tool call and return the reminder message for this response (if any).
   * Call this BEFORE processing the tool handler.
   */
  recordToolCall(operation: string): string | undefined {
    if (!this.config.enabled) return undefined;

    this.toolCallCount++;
    this.callsSinceLastSave++;

    if (this.firstToolCallAt === undefined) {
      this.firstToolCallAt = new Date().toISOString();
    }

    // Level 0: very first call of the session
    if (this.toolCallCount === 1) {
      return LEVEL_0_MESSAGE;
    }

    // After a save, use callsSinceLastSave for re-nudging
    if (this.memorySavedThisSession) {
      if (this.callsSinceLastSave >= this.config.reNudgeAfter) {
        return LEVEL_1_MESSAGE;
      }
      return undefined;
    }

    // Escalation based on total calls (no save yet this session)
    const { threshold, escalation } = this.config;

    if (this.toolCallCount >= threshold + 2 * escalation) {
      return LEVEL_3_TEMPLATE.replace("{count}", String(this.toolCallCount));
    }
    if (this.toolCallCount >= threshold + escalation) {
      return LEVEL_2_TEMPLATE.replace("{count}", String(this.toolCallCount));
    }
    if (this.toolCallCount >= threshold) {
      return LEVEL_1_MESSAGE;
    }

    return undefined;
  }

  /** Call when a save operation completes successfully. */
  recordMemorySaved(): void {
    this.memorySavedThisSession = true;
    this.callsSinceLastSave = 0;
  }

  /** Check if the given operation name is a save operation. */
  isSaveOperation(operation: string): boolean {
    return SAVE_OPERATIONS.has(operation);
  }

  /** Expose internal state for testing and diagnostics. */
  getState(): {
    toolCallCount: number;
    memorySavedThisSession: boolean;
    callsSinceLastSave: number;
    firstToolCallAt: string | undefined;
  } {
    return {
      toolCallCount: this.toolCallCount,
      memorySavedThisSession: this.memorySavedThisSession,
      callsSinceLastSave: this.callsSinceLastSave,
      firstToolCallAt: this.firstToolCallAt
    };
  }
}
