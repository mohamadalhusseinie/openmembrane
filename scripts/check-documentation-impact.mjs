import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;
if (!pr || !/^[a-f0-9]{40}$/.test(pr.base?.sha) || !/^[a-f0-9]{40}$/.test(pr.head?.sha)) {
  throw new Error("A pull_request event with valid base and head commit SHAs is required.");
}

const body = (pr.body ?? "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
const section = /^## Documentation impact[ \t]*\n([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/m.exec(body)?.[1] ?? "";
const selections = [...section.matchAll(/^- \[[xX]\] (Updated documentation|No documentation impact)[ \t]*$/gm)];
const details = /^### Details[ \t]*\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/m.exec(section)?.[1]?.trim();

if (selections.length !== 1 || !details) {
  process.stderr.write(
    "Complete '## Documentation impact' in the PR body: select exactly one option " +
    "('Updated documentation' or 'No documentation impact') and explain it under '### Details'.\n",
  );
  process.exitCode = 1;
} else if (selections[0][1] === "Updated documentation") {
  const files = execFileSync(
    "git", ["diff", "--name-only", "-z", "--no-renames", `${pr.base.sha}...${pr.head.sha}`, "--"],
    { encoding: "utf8" },
  ).split("\0").filter(Boolean);
  const documentationChanged = files.some((path) =>
    !/(^|\/)CHANGELOG\.md$/i.test(path) &&
    (/^[^/]+\.md$/i.test(path) ||
      /^docs\/.+\.(?:md|mdx)$/i.test(path) ||
      /^(?:apps|packages)\/.+\/README\.md$/i.test(path)),
  );
  if (!documentationChanged) {
    process.stderr.write(
      "'Updated documentation' requires a documentation-file change in this PR. " +
      "Update affected docs or select 'No documentation impact' and explain why. " +
      "Changesets and changelogs alone do not count.\n",
    );
    process.exitCode = 1;
  }
}

if (!process.exitCode) process.stdout.write("Documentation impact assessment passed.\n");
