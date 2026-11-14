import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const script = resolve("scripts", "check-documentation-impact.mjs");
let root: string;
let base: string;
let releaseOnly: string;
let docs: string;

async function git(...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
}

async function check(body: string | null, head = docs): Promise<{ stdout: string; stderr: string }> {
  const eventPath = join(root, "event.json");
  await writeFile(eventPath, JSON.stringify({
    pull_request: { body, base: { sha: base }, head: { sha: head } },
  }));
  return exec(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
  });
}

function assessment(selection: string, details: string): string {
  return `## Documentation impact\n${selection}\n\n### Details\n${details}\n\n## Validation\nChecked.\n`;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "om-docs-impact-"));
  await git("init");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
  await writeFile(join(root, "code.ts"), "export const value = 1;\n");
  await git("add", ".");
  await git("commit", "-m", "baseline");
  base = await git("rev-parse", "HEAD");
  await mkdir(join(root, ".changeset"));
  await writeFile(join(root, ".changeset", "change.md"), "Release note.\n");
  await writeFile(join(root, "CHANGELOG.md"), "Release history.\n");
  await git("add", ".");
  await git("commit", "-m", "release notes only");
  releaseOnly = await git("rev-parse", "HEAD");
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "setup.md"), "Updated setup.\n");
  await git("add", ".");
  await git("commit", "-m", "documentation");
  docs = await git("rev-parse", "HEAD");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("documentation impact CI enforcement", () => {
  it("accepts documented updates with a documentation diff and CRLF PR text", async () => {
    const body = assessment("- [x] Updated documentation", "docs/setup.md: explain the new setup.");
    expect((await check(body.replace(/\n/g, "\r\n"))).stdout).toContain("passed");
  });

  it("accepts a justified no-impact assessment without documentation changes", async () => {
    const body = assessment("- [X] No documentation impact", "Internal refactor; public behavior is unchanged.");
    expect((await check(body, base)).stdout).toContain("passed");
  });

  it("accepts the completed repository PR template", async () => {
    const template = await readFile(resolve(".github", "pull_request_template.md"), "utf8");
    const body = template
      .replace("- [ ] No documentation impact", "- [x] No documentation impact")
      .replace("### Details", "### Details\n\nOnly internal test fixtures change; documented behavior is unchanged.");
    expect((await check(body, base)).stdout).toContain("passed");
    await expect(check(template)).rejects.toMatchObject({ code: 1 });
  });

  it.each([
    null,
    "## Summary\nNo assessment.\n",
    assessment("- [ ] Updated documentation\n- [ ] No documentation impact", "Not selected."),
    assessment("- [x] Updated documentation\n- [x] No documentation impact", "Both selected."),
    assessment("- [x] No documentation impact", "<!-- Explain here. -->"),
    "## Documentation impact\n- [x] No documentation impact\n## Validation\n### Details\nWrong section.\n",
    `<!-- ${assessment("- [x] No documentation impact", "Hidden assessment.")} -->`,
  ])("rejects a missing, ambiguous, or unexplained assessment (%#)", async (body) => {
    await expect(check(body)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Complete '## Documentation impact'"),
    });
  });

  it.each(["base", "release"])("rejects claimed updates with only %s changes", async (kind) => {
    const body = assessment("- [x] Updated documentation", "Updated documentation.");
    await expect(check(body, kind === "base" ? base : releaseOnly)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("requires a documentation-file change"),
    });
  });
});
