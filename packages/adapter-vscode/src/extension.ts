import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { createDaemonAutoLaunch, OpenMembraneClient, OpenMembraneClientError } from "@openmembrane/client";
import { openReview } from "./review";

export interface ExtensionApi {
  participant: vscode.ChatParticipant;
  mcpProvider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>;
}

function isHostFile(uri: vscode.Uri): boolean {
  return uri.scheme === "file" || (vscode.env.remoteName !== undefined && uri.scheme === "vscode-remote");
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi | undefined> {
  if (!vscode.workspace.isTrusted) return;
  const output = vscode.window.createOutputChannel("OpenMembrane");
  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(output, changed);
  const cli = context.asAbsolutePath(join("dist", "cli.mjs"));
  const clients = new Map<string, OpenMembraneClient>();

  function report(error: unknown): string {
    const message = error instanceof OpenMembraneClientError
      ? `${error.safeMessage} [${error.code}]${error.diagnosticId ? ` (diagnostic: ${error.diagnosticId})` : ""}`
      : "OpenMembrane operation failed. Check the selected workspace, input file, and local daemon diagnostics.";
    output.appendLine(message);
    void vscode.window.showErrorMessage(message);
    return message;
  }

  function client(folder: vscode.WorkspaceFolder): OpenMembraneClient {
    let value = clients.get(folder.uri.fsPath);
    if (!value) {
      value = new OpenMembraneClient({
        projectRoot: folder.uri.fsPath,
        requestTimeoutMs: 30 * 60_000,
        autoLaunch: createDaemonAutoLaunch(process.execPath, [cli, "serve"], {
          cwd: folder.uri.fsPath,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        }),
      });
      clients.set(folder.uri.fsPath, value);
    }
    return value;
  }

  function folders(): readonly vscode.WorkspaceFolder[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((folder) => isHostFile(folder.uri));
  }

  async function selectFolder(): Promise<vscode.WorkspaceFolder> {
    const all = folders();
    if (all.length === 0) throw new OpenMembraneClientError("E_VSCODE_WORKSPACE", "Open a local workspace folder to use OpenMembrane.");
    if (all.length === 1) return all[0]!;
    const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Choose the OpenMembrane project" });
    if (!picked || !isHostFile(picked.uri)) throw new vscode.CancellationError();
    return picked;
  }

  async function save(daemon: OpenMembraneClient, transcript: string): Promise<void> {
    if (!transcript.trim() || transcript.length > 100_000) {
      throw new OpenMembraneClientError("E_VSCODE_TRANSCRIPT", "Choose a non-empty chat export of at most 100,000 characters. Split larger exports before saving.");
    }
    const result = await daemon.ingest({
      tool: "vscode-copilot",
      sessionId: `vscode-${createHash("sha256").update(transcript).digest("hex")}`,
      transcript,
    });
    void vscode.window.showInformationMessage(
      `OpenMembrane: ${result.savedCount} saved, ${result.pendingCount} pending, ${result.rejectedCount} rejected.`,
    );
  }

  const review = async (folder: vscode.WorkspaceFolder): Promise<void> => {
    await openReview(client(folder), folder.name, report, context.subscriptions);
  };

  function register(id: string, handler: (folder: vscode.WorkspaceFolder) => Promise<void>): void {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try {
        await handler(await selectFolder());
      } catch (error) {
        if (!(error instanceof vscode.CancellationError)) report(error);
      }
    }));
  }

  register("openmembrane.review", review);
  register("openmembrane.export", async (folder) => {
    const result = await client(folder).exportStaticMemoryFiles({ preview: true });
    const answer = await vscode.window.showWarningMessage(
      `Write ${result.files.length} static memory files in ${folder.name}? Existing exports will be replaced. These files may be committed or sent to AI tools.`,
      { modal: true }, "Export",
    );
    if (answer !== "Export") return;
    await client(folder).exportStaticMemoryFiles({});
    void vscode.window.showInformationMessage("OpenMembrane static files exported.");
  });
  register("openmembrane.diagnostics", async (folder) => {
    const diagnostics = await client(folder).getDiagnostics({ limit: 100 });
    output.clear();
    output.appendLine(`Diagnostics: ${folder.name}`);
    for (const event of diagnostics) {
      output.appendLine(`${event.createdAt} [${event.severity}] ${event.code} (${event.id}): ${event.message}`);
    }
    if (diagnostics.length === 0) output.appendLine("No diagnostics.");
    output.show(true);
  });
  register("openmembrane.saveChat", async (folder) => {
    const files = await vscode.window.showOpenDialog({
      title: "Select an exported Copilot chat transcript",
      canSelectMany: false, canSelectFolders: false,
      filters: { "Chat transcripts": ["json", "md", "txt"] },
    });
    const file = files?.[0];
    if (!file) return;
    if (!isHostFile(file) || (await stat(file.fsPath)).size > 1_000_000) {
      throw new OpenMembraneClientError("E_VSCODE_TRANSCRIPT", "Choose a local transcript smaller than 1 MB.");
    }
    const transcript = await readFile(file.fsPath, "utf8");
    const answer = await vscode.window.showWarningMessage(
      `Send the selected chat export to OpenMembrane for ${folder.name}? The daemon will redact secrets and apply its configured extraction policy, which may use an external provider.`,
      { modal: true }, "Save session",
    );
    if (answer === "Save session") await save(client(folder), transcript);
  });

  const mcpProvider: ExtensionApi["mcpProvider"] = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => folders().map((folder) => {
      const definition = new vscode.McpStdioServerDefinition(
        `OpenMembrane (${folder.name})`, process.execPath, [cli, "mcp"],
        { ELECTRON_RUN_AS_NODE: "1" }, context.extension.packageJSON.version as string,
      );
      definition.cwd = folder.uri;
      return definition;
    }),
  };
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("openmembrane", mcpProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      clients.clear();
      changed.fire();
      void bootstrap();
    }),
  );

  const participant = vscode.chat.createChatParticipant("openmembrane.chat", async (request, history, stream, token) => {
    try {
      const folder = await selectFolder();
      if (token.isCancellationRequested) return;
      const daemon = client(folder);
      const [verb = "", ...words] = request.prompt.trim().split(/\s+/);
      const command = request.command ?? verb.toLowerCase();
      const query = request.command ? request.prompt.trim() : words.join(" ");
      let response: string;
      if (command === "rules") {
        const result = await daemon.getProjectRules({});
        response = result.rules.map((rule) => rule.content).join("\n\n") || "No project rules saved.";
      } else if (command === "recall") {
        if (!query) {
          stream.markdown("Use `@openmembrane /recall <query>`.");
          return;
        }
        const result = await daemon.getRelevantContext({ query });
        response = result.memories.map((memory) => memory.content).join("\n\n") || "No relevant memories found.";
      } else if (command === "review") {
        const candidates = await daemon.listMemoryCandidates({ limit: null });
        stream.markdown(`${candidates.length} pending candidate(s). Opening the review panel.`);
        await review(folder);
        return;
      } else if (command === "save") {
        const transcript = history.history.map((turn) => turn instanceof vscode.ChatRequestTurn
          ? `user: ${turn.command ? `/${turn.command} ` : ""}${turn.prompt}`
          : `assistant: ${turn.response.flatMap((part) => part instanceof vscode.ChatResponseMarkdownPart ? [part.value.value] : []).join("\n")}`,
        ).join("\n\n");
        await save(daemon, transcript);
        stream.markdown("Visible @openmembrane history sent to the daemon.");
        return;
      } else {
        stream.markdown("Use `/rules`, `/recall <query>`, `/review`, or `/save`. To capture other Copilot chats, export the chat and run **Save chat session to OpenMembrane**.");
        return;
      }
      if (token.isCancellationRequested) return;
      // Stored content is data, not trusted Markdown commands or links.
      const text = new vscode.MarkdownString();
      text.appendText(response);
      stream.markdown(text);
      if (vscode.workspace.getConfiguration("openmembrane", folder.uri).get<boolean>("autoSave", false)) {
        await save(daemon, `user: ${request.command ?? command} ${query}\n\nassistant: ${response}`);
      }
    } catch (error) {
      if (!(error instanceof vscode.CancellationError)) return { errorDetails: { message: report(error) } };
    }
  });
  context.subscriptions.push(participant);

  async function bootstrap(): Promise<void> {
    const folder = folders()[0];
    if (!folder) return;
    try {
      await client(folder).health();
    } catch (error) {
      report(error);
    }
  }
  await bootstrap();
  return { participant, mcpProvider };
}
