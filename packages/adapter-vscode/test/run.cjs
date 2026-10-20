const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "om-vsc-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "project");
  await mkdir(home);
  await mkdir(path.join(workspace, ".vscode"), { recursive: true });
  await writeFile(path.join(workspace, ".vscode", "settings.json"), JSON.stringify({
    "security.workspace.trust.enabled": false,
    "chat.disableAIFeatures": false,
  }));
  const env = {
    ...process.env,
    HOME: home, USERPROFILE: home, XDG_RUNTIME_DIR: root,
    OPENMEMBRANE_HOME: path.join(workspace, ".openmembrane"),
    OPENMEMBRANE_PROJECT_ID: "vscode-host-test",
    OPENMEMBRANE_STORAGE_BACKEND: "json",
    OPENMEMBRANE_EXTRACTION_ENABLED: "false",
    OPENMEMBRANE_VSCODE_TEST_ROOT: root,
  };
  try {
    await runTests({
      version: "1.104.0",
      extensionDevelopmentPath: path.resolve(__dirname, ".."),
      extensionTestsPath: path.join(__dirname, "suite.cjs"),
      extensionTestsEnv: env,
      launchArgs: [
        workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes",
        "--disable-workspace-trust", "--no-sandbox",
        "--user-data-dir", path.join(root, "user-data"),
        "--extensions-dir", path.join(root, "extensions"),
      ],
    });
  } finally {
    const stopped = spawnSync(process.execPath, [path.resolve(__dirname, "../dist/cli.mjs"), "stop"], {
      env, encoding: "utf8", timeout: 35_000,
    });
    if (stopped.status !== 0) {
      throw new Error(`Test daemon cleanup failed: ${stopped.stderr || stopped.error || stopped.status}`);
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
