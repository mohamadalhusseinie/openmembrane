const { mkdtemp, mkdir, rm, writeFile, readdir, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runTests } = require("@vscode/test-electron");

async function printFailureLogs(root) {
  const logs = path.join(root, "user-data", "logs");
  try {
    for (const file of await readdir(logs, { recursive: true })) {
      if (file.endsWith(".log") && /exthost|renderer|output_logging|main\.log/.test(file)) {
        console.error(`--- ${file} ---\n${(await readFile(path.join(logs, file), "utf8")).slice(-12_000)}`);
      }
    }
  } catch (error) {
    console.error("Could not read extension host failure logs:", error);
  }
}

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
  const watchdog = setTimeout(() => {
    console.error("Extension host has not completed after 90 seconds; collecting startup diagnostics.");
    void printFailureLogs(root);
  }, 90_000);
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
  } catch (error) {
    await printFailureLogs(root);
    throw error;
  } finally {
    clearTimeout(watchdog);
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
