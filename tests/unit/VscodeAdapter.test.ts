import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  trusted: true,
  autoSave: false,
  remoteName: undefined as string | undefined,
  folders: [{ name: "project", uri: { fsPath: "C:\\project", scheme: "file" } }],
  commands: new Map<string, () => Promise<void>>(),
  messages: [] as string[],
  output: [] as string[],
  subscriptions: [] as { dispose(): void }[],
  receive: undefined as ((message: unknown) => Promise<void>) | undefined,
  html: "",
  openDialog: vi.fn(),
  warning: vi.fn(),
  pick: vi.fn(),
  clientOptions: [] as unknown[],
  daemon: {
    health: vi.fn(),
    getProjectRules: vi.fn(),
    getRelevantContext: vi.fn(),
    listMemoryCandidates: vi.fn(),
    approveMemoryCandidate: vi.fn(),
    rejectMemoryCandidate: vi.fn(),
    exportStaticMemoryFiles: vi.fn(),
    getDiagnostics: vi.fn(),
    ingest: vi.fn(),
  },
}));

vi.mock("@openmembrane/client", async (original) => {
  const actual = await original<typeof import("@openmembrane/client")>();
  return {
    ...actual,
    createDaemonAutoLaunch: vi.fn(() => vi.fn()),
    OpenMembraneClient: class {
      constructor(options: unknown) { state.clientOptions.push(options); Object.assign(this, state.daemon); }
    },
  };
});

vi.mock("vscode", () => {
  class MarkdownString {
    constructor(public value = "") {}
    appendText(value: string): void { this.value += value; }
  }
  const disposable = () => ({ dispose: vi.fn() });
  return {
    CancellationError: class extends Error {},
    MarkdownString,
    ChatRequestTurn: class { constructor(readonly prompt: string) {} },
    ChatResponseMarkdownPart: class { constructor(readonly value: MarkdownString) {} },
    McpStdioServerDefinition: class {
      constructor(readonly label: string, readonly command: string, readonly args: string[], readonly env: unknown) {}
    },
    EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
    ViewColumn: { One: 1 },
    env: { get remoteName() { return state.remoteName; } },
    workspace: {
      get isTrusted() { return state.trusted; },
      get workspaceFolders() { return state.folders; },
      getConfiguration: () => ({ get: () => state.autoSave }),
      onDidChangeWorkspaceFolders: vi.fn(disposable),
    },
    window: {
      createOutputChannel: () => ({
        appendLine: (line: string) => state.output.push(line),
        clear: () => { state.output = []; }, show: vi.fn(), ...disposable(),
      }),
      showErrorMessage: (message: string) => state.messages.push(message),
      showInformationMessage: vi.fn(),
      showWarningMessage: state.warning,
      showOpenDialog: state.openDialog,
      showWorkspaceFolderPick: state.pick,
      createWebviewPanel: () => ({
        webview: {
          get html() { return state.html; }, set html(value: string) { state.html = value; },
          onDidReceiveMessage: (handler: typeof state.receive) => { state.receive = handler; return disposable(); },
        },
        onDidDispose: vi.fn(), ...disposable(),
      }),
    },
    commands: {
      registerCommand: (id: string, handler: () => Promise<void>) => { state.commands.set(id, handler); return disposable(); },
    },
    lm: { registerMcpServerDefinitionProvider: vi.fn(disposable) },
    chat: { createChatParticipant: (id: string, requestHandler: unknown) => ({ id, requestHandler, ...disposable() }) },
  };
});

import * as vscode from "vscode";
import { OpenMembraneClientError } from "@openmembrane/client";
import { activate } from "../../packages/adapter-vscode/src/extension";
import { exportedChatTranscript, transcriptTurn } from "../../packages/adapter-vscode/src/transcript";
import { MockMemoryExtractor, SecretDetector } from "@openmembrane/core";

async function start() {
  return activate({
    asAbsolutePath: (path: string) => join("extension", path),
    extension: { packageJSON: { version: "1.0.2" } },
    subscriptions: state.subscriptions,
  } as unknown as vscode.ExtensionContext);
}

async function chat(command: string | undefined, prompt = "", cancelled = false, history: vscode.ChatContext["history"] = []) {
  const api = await start();
  const markdown = vi.fn();
  const result = await api!.participant.requestHandler(
    { command, prompt } as vscode.ChatRequest,
    { history },
    { markdown } as unknown as vscode.ChatResponseStream,
    { isCancellationRequested: cancelled } as vscode.CancellationToken,
  );
  return { result, markdown };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.trusted = true;
  state.autoSave = false;
  state.remoteName = undefined;
  state.folders = [{ name: "project", uri: { fsPath: "C:\\project", scheme: "file" } }];
  state.commands.clear();
  state.messages = [];
  state.output = [];
  state.clientOptions = [];
  state.subscriptions = [];
  state.html = "";
  state.receive = undefined;
  state.daemon.health.mockResolvedValue({});
  state.daemon.getProjectRules.mockResolvedValue({ rules: [{ content: "Use strict types." }] });
  state.daemon.getRelevantContext.mockResolvedValue({ memories: [{ content: "Use local memory." }] });
  state.daemon.listMemoryCandidates.mockResolvedValue([]);
  state.daemon.approveMemoryCandidate.mockResolvedValue({});
  state.daemon.rejectMemoryCandidate.mockResolvedValue({});
  state.daemon.getDiagnostics.mockResolvedValue([]);
  state.daemon.exportStaticMemoryFiles.mockResolvedValue({ files: [] });
  state.daemon.ingest.mockResolvedValue({ savedCount: 1, pendingCount: 0, rejectedCount: 0 });
  state.warning.mockResolvedValue(undefined);
  state.openDialog.mockResolvedValue(undefined);
  state.pick.mockResolvedValue(undefined);
});

afterEach(() => { for (const disposable of state.subscriptions) disposable.dispose(); });

describe("VS Code adapter", () => {
  it("bootstraps health, registers per-folder MCP definitions and all commands", async () => {
    const api = await start();
    expect(state.daemon.health).toHaveBeenCalledOnce();
    expect(vscode.lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith("openmembrane", api!.mcpProvider);
    const definitions = await api!.mcpProvider.provideMcpServerDefinitions({} as vscode.CancellationToken);
    expect(definitions).toHaveLength(1);
    expect(definitions![0]!.args).toEqual([join("extension", "dist", "cli.mjs"), "mcp"]);
    expect(definitions![0]!.cwd).toEqual(state.folders[0]!.uri);
    expect([...state.commands.keys()]).toEqual([
      "openmembrane.review", "openmembrane.export", "openmembrane.diagnostics", "openmembrane.saveChat",
    ]);
    expect(state.clientOptions[0]).toMatchObject({ projectRoot: "C:\\project", requestTimeoutMs: 1_800_000 });
  });

  it("does nothing in untrusted workspaces", async () => {
    state.trusted = false;
    expect(await start()).toBeUndefined();
    expect(state.daemon.health).not.toHaveBeenCalled();
  });

  it("avoids startup and MCP servers without a local project", async () => {
    state.folders = [];
    const api = await start();
    expect(state.daemon.health).not.toHaveBeenCalled();
    expect(await api!.mcpProvider.provideMcpServerDefinitions({} as vscode.CancellationToken)).toEqual([]);
    await state.commands.get("openmembrane.diagnostics")!();
    expect(state.messages[0]).toContain("Open a local workspace");
  });

  it("bootstraps and registers remote filesystem folders on the remote host, not virtual folders", async () => {
    state.remoteName = "ssh-remote";
    state.folders = [{ name: "remote", uri: { fsPath: "/workspace/project", scheme: "vscode-remote" } }];
    const api = await start();
    expect(state.daemon.health).toHaveBeenCalledOnce();
    const definitions = await api!.mcpProvider.provideMcpServerDefinitions({} as vscode.CancellationToken);
    expect(definitions).toHaveLength(1);
    expect(definitions![0]!.cwd).toEqual(state.folders[0]!.uri);
    await state.commands.get("openmembrane.diagnostics")!();
    expect(state.clientOptions.at(-1)).toMatchObject({ projectRoot: "/workspace/project" });
    state.folders = [{ name: "virtual", uri: { fsPath: "/virtual", scheme: "github" } }];
    expect(await api!.mcpProvider.provideMcpServerDefinitions({} as vscode.CancellationToken)).toEqual([]);
  });

  it.each([["rules", ""], [undefined, "rules"]] as const)("handles rules via %s %s without capturing by default", async (command, prompt) => {
    const { markdown } = await chat(command, prompt);
    expect(markdown.mock.calls[0]![0].value).toBe("Use strict types.");
    expect(state.daemon.ingest).not.toHaveBeenCalled();
  });

  it("handles plain-text recall and validates missing queries", async () => {
    await chat(undefined, "recall local storage");
    expect(state.daemon.getRelevantContext).toHaveBeenCalledWith({ query: "local storage" });
    await chat("recall", "");
    expect(state.daemon.getRelevantContext).toHaveBeenCalledTimes(1);
  });

  it("only auto-saves completed retrieval exchanges when opted in", async () => {
    state.autoSave = true;
    await chat("recall", "storage");
    expect(state.daemon.ingest).toHaveBeenCalledWith(expect.objectContaining({
      transcript: "user (/recall):\nstorage\n\nassistant:\nUse local memory.",
      tool: "vscode-copilot", sessionId: expect.stringMatching(/^vscode-[a-f0-9]{64}$/),
    }));
    await chat("review");
    expect(state.daemon.ingest).toHaveBeenCalledTimes(1);
  });

  it("explicitly saves only the participant history supplied by VS Code", async () => {
    const request: vscode.ChatRequestTurn = {
      prompt: "Explain local storage", participant: "openmembrane.chat", references: [], toolReferences: [],
    };
    Object.setPrototypeOf(request, vscode.ChatRequestTurn.prototype);
    const response: vscode.ChatResponseTurn = {
      response: [new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString("Keep it local."))],
      participant: "openmembrane.chat", result: {},
    };
    await chat("save", "", false, [request, response]);
    expect(state.daemon.ingest).toHaveBeenCalledWith(expect.objectContaining({
      transcript: "user:\nExplain local storage\n\nassistant:\nKeep it local.",
    }));
  });

  it("does not retrieve or ingest cancelled requests", async () => {
    state.autoSave = true;
    await chat("rules", "", true);
    expect(state.daemon.getProjectRules).not.toHaveBeenCalled();
    expect(state.daemon.ingest).not.toHaveBeenCalled();
  });

  it("surfaces safe errors and diagnostic IDs, not raw errors", async () => {
    state.daemon.getProjectRules.mockRejectedValue(new OpenMembraneClientError("FAILED", "Safe failure", { diagnosticId: "diag-42" }));
    const { result } = await chat("rules");
    expect(result).toMatchObject({ errorDetails: { message: "Safe failure [FAILED] (diagnostic: diag-42)" } });
    state.daemon.health.mockRejectedValue(new Error("secret raw details"));
    await start();
    expect(state.messages.join("\n")).not.toContain("secret raw details");
  });

  it("requires explicit export confirmation", async () => {
    await start();
    await state.commands.get("openmembrane.export")!();
    expect(state.daemon.exportStaticMemoryFiles).toHaveBeenCalledWith({ preview: true });
    expect(state.daemon.exportStaticMemoryFiles).toHaveBeenCalledTimes(1);
    state.warning.mockResolvedValue("Export");
    await state.commands.get("openmembrane.export")!();
    expect(state.daemon.exportStaticMemoryFiles).toHaveBeenLastCalledWith({});
  });

  it("shows daemon diagnostics", async () => {
    state.daemon.getDiagnostics.mockResolvedValue([{ createdAt: "today", severity: "warn", code: "TEST", id: "diag", message: "Safe" }]);
    await start();
    await state.commands.get("openmembrane.diagnostics")!();
    expect(state.output.join("\n")).toContain("TEST (diag): Safe");
  });

  it.each(["file", "vscode-remote"])("imports a %s export only after confirmation", async (scheme) => {
    const root = await mkdtemp(join(tmpdir(), "om-export-"));
    try {
      const file = join(root, "chat.json");
      await writeFile(file, '{"requests":[{"message":"Use strict types."}]}');
      state.remoteName = scheme === "vscode-remote" ? "ssh-remote" : undefined;
      state.openDialog.mockResolvedValue([{ scheme, fsPath: file }]);
      await start();
      await state.commands.get("openmembrane.saveChat")!();
      expect(state.daemon.ingest).not.toHaveBeenCalled();
      state.warning.mockResolvedValue("Save session");
      await state.commands.get("openmembrane.saveChat")!();
      expect(state.daemon.ingest).toHaveBeenCalledWith(expect.objectContaining({ transcript: "user:\nUse strict types." }));
      await writeFile(file, JSON.stringify({ requests: [{ message: "x".repeat(100_001) }] }));
      await state.commands.get("openmembrane.saveChat")!();
      expect(state.daemon.ingest).toHaveBeenCalledTimes(1);
      expect(state.messages.at(-1)).toContain("100,000");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports team proposal states instead of hiding publication outcomes", async () => {
    state.autoSave = true;
    state.daemon.ingest.mockResolvedValue({
      savedCount: 0, pendingCount: 0, rejectedCount: 0, proposalCount: 2,
      proposals: [{ memoryId: "one", state: "proposed" }, { memoryId: "two", state: "retry_scheduled", nextAttemptAt: "later" }],
    });
    await chat("rules");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining(
      "2 team proposals (proposed: 1, retry_scheduled: 1)",
    ));
  });

  it("renders escaped candidates and accepts only valid review messages", async () => {
    state.daemon.listMemoryCandidates.mockResolvedValue([{
      id: "candidate-1", type: "coding_rule", sensitivity: "internal", recommendedAction: "ask_user",
      content: "<script>alert('x')</script>", reason: "<unsafe>",
    }]);
    await start();
    await state.commands.get("openmembrane.review")!();
    expect(state.html).toContain("&lt;script&gt;");
    expect(state.html).not.toContain("<script>alert");
    expect(state.html).toContain("default-src 'none'");
    await state.receive!({ action: "approve", id: "missing" });
    expect(state.daemon.approveMemoryCandidate).not.toHaveBeenCalled();
    await state.receive!({ action: "approve", id: "candidate-1" });
    expect(state.daemon.approveMemoryCandidate).toHaveBeenCalledWith({ candidateId: "candidate-1" });
    await state.receive!({ action: "reject", id: "candidate-1" });
    expect(state.daemon.rejectMemoryCandidate).toHaveBeenCalledWith({ candidateId: "candidate-1" });
  });

  describe("VS Code transcript normalization", () => {
    it("decodes real export message/markdown shapes before daemon secret redaction and extraction", async () => {
      const source = JSON.stringify({
        requesterUsername: "Developer", responderUsername: "GitHub Copilot",
        requests: [{
          message: { text: 'remember: Always use strict TypeScript types.\npassword="fixturePassword123"', parts: [] },
          variableData: { variables: [{ value: "private reference metadata" }] },
          response: [{ value: "Confirmed.\n" }, { value: "testing: Run extension host tests before publishing." }, { kind: "thinking", value: "private reasoning" }],
        }, { message: "Legacy string request", response: [] }],
      });
      const transcript = exportedChatTranscript(source, "chat.json");
      expect(transcript).toContain('user:\nremember: Always use strict TypeScript types.\npassword="fixturePassword123"');
      expect(transcript).toContain("assistant:\nConfirmed.\ntesting: Run extension host tests before publishing.");
      expect(transcript).not.toContain("private reference metadata");
      expect(transcript).not.toContain("private reasoning");
      const redacted = new SecretDetector().redact(transcript);
      expect(redacted.redactedText).not.toContain("fixturePassword123");
      const extracted = await new MockMemoryExtractor().extract({ projectId: "test", transcript: redacted.redactedText });
      expect(extracted.map((item) => item.content)).toEqual([
        "Always use strict TypeScript types.", "Run extension host tests before publishing.",
      ]);
    });

    it("preserves first-line marked facts in participant history and auto-save", async () => {
      const transcript = transcriptTurn("user", "remember: Always use strict TypeScript types.", "recall");
      const extracted = await new MockMemoryExtractor().extract({ projectId: "test", transcript });
      expect(extracted[0]?.content).toBe("Always use strict TypeScript types.");
    });

    it("accepts plain transcripts and fails visibly on malformed or unsupported JSON", () => {
      expect(exportedChatTranscript("remember: Keep it local.\n", "chat.md")).toBe("remember: Keep it local.\n");
      for (const source of ["{bad", "{}", '{"requests":[{"message":42}]}', '{"requests":[]}']) {
        expect(() => exportedChatTranscript(source, "chat.json")).toThrow("valid VS Code chat JSON export");
      }
    });
  });

  it("uses the explicitly selected folder in multi-root workspaces", async () => {
    state.folders.push({ name: "other", uri: { fsPath: "C:\\other", scheme: "file" } });
    state.pick.mockResolvedValue(state.folders[1]);
    await chat("rules");
    expect(state.clientOptions.at(-1)).toMatchObject({ projectRoot: "C:\\other" });
  });
});
