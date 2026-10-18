import type { Hooks, PluginInput } from "@opencode-ai/plugin";

type Messages = NonNullable<Awaited<ReturnType<PluginInput["client"]["session"]["messages"]>>["data"]>;
export const sessionId = "ses_fixture";
export const sessionMessages: Messages = [
  {
    info: {
      id: "msg_user", sessionID: sessionId, role: "user", time: { created: 1 },
      agent: "build", model: { providerID: "local", modelID: "fixture" },
    },
    parts: [
      { id: "part_user", sessionID: sessionId, messageID: "msg_user", type: "text",
        text: "The project must use isolated Vitest fixtures for integration tests." },
      { id: "part_rule", sessionID: sessionId, messageID: "msg_user", type: "text", text: "rule: Use pnpm." },
      { id: "part_ignored", sessionID: sessionId, messageID: "msg_user", type: "text",
        ignored: true, text: "rule: The project uses obsolete fixtures." },
    ],
  },
  {
    info: {
      id: "msg_assistant", sessionID: sessionId, role: "assistant", time: { created: 2, completed: 3 },
      parentID: "msg_user", modelID: "fixture", providerID: "local", mode: "build",
      path: { cwd: "/fixture", root: "/fixture" }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      { id: "part_start", sessionID: sessionId, messageID: "msg_assistant", type: "step-start" },
      { id: "part_assistant", sessionID: sessionId, messageID: "msg_assistant", type: "text",
        text: "Understood. I will use isolated fixtures." },
    ],
  },
];

export const expectedTranscript = "user:\nThe project must use isolated Vitest fixtures for integration tests.\nrule: Use pnpm.\n\n" +
  "assistant:\nUnderstood. I will use isolated fixtures.";

export const model: Parameters<NonNullable<Hooks["experimental.chat.system.transform"]>>[0]["model"] = {
  id: "fixture", providerID: "local", name: "Fixture",
  api: { id: "fixture", url: "http://localhost", npm: "fixture" },
  capabilities: {
    temperature: true, reasoning: false, attachment: false, toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 32_000, output: 4_000 }, status: "active", options: {}, headers: {},
};
