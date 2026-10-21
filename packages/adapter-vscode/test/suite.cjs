const assert = require("node:assert/strict");
const { access, readFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createHash } = require("node:crypto");
const path = require("node:path");
const vscode = require("vscode");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function run() {
  const extension = vscode.extensions.getExtension("mohamadalhusseinie.openmembrane-vscode");
  assert.ok(extension, "Extension must be discoverable");
  console.log("Activating OpenMembrane in the isolated extension host");
  let timer;
  let api;
  try {
    api = await Promise.race([
      extension.activate(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Extension activation exceeded 60 seconds")), 60_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(extension.isActive, true);
  assert.equal(api.participant.id, "openmembrane.chat");
  const root = process.env.OPENMEMBRANE_VSCODE_TEST_ROOT;
  const runDir = process.platform === "win32"
    ? path.join(root, "home", ".openmembrane", "run")
    : path.join(root, "openmembrane");
  await access(path.join(runDir, "token"));
  console.log("PASS activation bootstraps the isolated daemon");

  const cancellation = new vscode.CancellationTokenSource();
  const definitions = await api.mcpProvider.provideMcpServerDefinitions(cancellation.token);
  assert.equal(definitions.length, 1);
  const definition = definitions[0];
  assert.ok(definition instanceof vscode.McpStdioServerDefinition);
  assert.equal(definition.cwd.fsPath, vscode.workspace.workspaceFolders[0].uri.fsPath);
  assert.equal(definition.args[1], "mcp");
  const mcp = new Client({ name: "vscode-extension-test", version: "1" });
  const ruleText = "Always run the extension host tests before publishing the `VSIX_package`.";
  const transport = new StdioClientTransport({
    command: definition.command, args: definition.args, cwd: definition.cwd.fsPath,
    env: Object.fromEntries(Object.entries({ ...process.env, ...definition.env })
      .filter((entry) => typeof entry[1] === "string")),
    stderr: "pipe",
  });
  try {
    await mcp.connect(transport);
    const tools = await mcp.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_project_rules"));
    const saved = await mcp.callTool({
      name: "remember",
      arguments: { content: ruleText, type: "coding_rule" },
    });
    assert.ok(!saved.isError, JSON.stringify(saved));
    const ingestion = JSON.parse(saved.content[0].text);
    for (const candidate of ingestion.pending) {
      const approved = await mcp.callTool({ name: "approve_memory_candidate", arguments: { candidateId: candidate.id } });
      assert.ok(!approved.isError, JSON.stringify(approved));
    }
    const retrieved = await mcp.callTool({ name: "get_project_rules", arguments: {} });
    assert.ok(!retrieved.isError, JSON.stringify(retrieved));
    assert.match(JSON.stringify(retrieved), /extension host tests/);
  } finally {
    await mcp.close();
  }
  console.log("PASS MCP registration and real bundled server retrieval");

  let lastResponse;
  async function chat(command, prompt, history = []) {
    const chunks = [];
    const response = [];
    const result = await api.participant.requestHandler(
      { command, prompt }, { history },
      { markdown: (value) => {
        chunks.push(typeof value === "string" ? value : value.value);
        response.push(new vscode.ChatResponseMarkdownPart(typeof value === "string" ? new vscode.MarkdownString(value) : value));
      } },
      cancellation.token,
    );
    assert.ok(!result?.errorDetails, JSON.stringify(result));
    lastResponse = { participant: "openmembrane.chat", result: result ?? {}, response };
    return chunks.join("\n").replace(/&nbsp;/g, " ");
  }
  assert.match(await chat("rules", ""), /extension host tests/);
  const retrievalResponse = lastResponse;
  assert.notEqual(retrievalResponse.response[0].value.value, ruleText, "Real appendText must escape the displayed text");
  assert.match(await chat("recall", "publishing VSIX"), /extension host tests/);
  assert.match(await chat(undefined, "recall"), /recall <query>/);
  console.log("PASS real participant rules and recall");

  const commands = await vscode.commands.getCommands(true);
  for (const id of ["review", "export", "diagnostics", "saveChat"]) {
    assert.ok(commands.includes(`openmembrane.${id}`), `${id} registered`);
  }
  await vscode.commands.executeCommand("openmembrane.diagnostics");
  await vscode.commands.executeCommand("openmembrane.review");
  assert.match(await chat("review", ""), /pending candidate/);
  console.log("PASS commands and participant candidate review");

  const requestTurn = Object.assign(Object.create(vscode.ChatRequestTurn.prototype), {
    prompt: "remember: Always use explicit types for extension API boundaries.",
    participant: "openmembrane.chat", references: [], toolReferences: [],
  });
  assert.match(await chat("save", "", [requestTurn, retrievalResponse]), /history sent to the daemon/);
  const captureClient = new Client({ name: "vscode-capture-test", version: "1" });
  try {
    await captureClient.connect(new StdioClientTransport({
      command: definition.command, args: definition.args, cwd: definition.cwd.fsPath,
      env: Object.fromEntries(Object.entries({ ...process.env, ...definition.env })
        .filter((entry) => typeof entry[1] === "string")),
      stderr: "pipe",
    }));
    const candidates = await captureClient.callTool({ name: "list_memory_candidates", arguments: {} });
    assert.ok(!candidates.isError, JSON.stringify(candidates));
    assert.match(JSON.stringify(candidates), /explicit types for extension API boundaries/);
    const expectedTranscript = `user:\n${requestTurn.prompt}\n\nassistant:\n${ruleText}`;
    assert.match(JSON.stringify(candidates), new RegExp(createHash("sha256").update(expectedTranscript).digest("hex")),
      "Captured transcript must contain original retrieval text, not real appendText display escapes");
  } finally {
    await captureClient.close();
  }
  console.log("PASS participant capture through real local daemon extraction");

  const manifest = JSON.parse(await readFile(path.join(extension.extensionPath, "package.json"), "utf8"));
  assert.equal(manifest.contributes.mcpServerDefinitionProviders[0].id, "openmembrane");
  assert.equal(manifest.contributes.configuration.properties["openmembrane.autoSave"].default, false);
  cancellation.dispose();
}

exports.run = async function runWithCleanup() {
  try {
    await run();
  } finally {
    await promisify(execFile)(process.execPath, [path.resolve(__dirname, "../dist/cli.mjs"), "stop"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 35_000,
    });
  }
};
