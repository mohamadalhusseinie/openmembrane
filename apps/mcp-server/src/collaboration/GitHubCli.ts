import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Command {
  executable: string;
  args: readonly string[];
  cwd?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
}

export interface CommandRunner {
  run(command: Command): Promise<CommandResult>;
}

export interface GitHubRepositoryView {
  nameWithOwner: string;
  isPrivate: boolean;
  defaultBranch: { name: string } | null;
  url: string;
}

export interface PullRequestInput {
  repository: string;
  base: string;
  head: string;
  title: string;
  body: string;
}

export interface GitHubPullRequestView {
  number: string;
  url: string;
  body: string;
}

export class GitHubCli {
  private readonly runner: CommandRunner;

  constructor(runner: CommandRunner = new ExecFileCommandRunner()) {
    this.runner = runner;
  }

  version(): Promise<CommandResult> {
    return this.runGh(["--version"]);
  }

  authStatus(host: string): Promise<CommandResult> {
    return this.runGh(["auth", "status", "--hostname", host]);
  }

  repositoryView(repository: string): Promise<CommandResult> {
    return this.runGh(["repo", "view", repository, "--json", "nameWithOwner,isPrivate,defaultBranch,url"]);
  }

  inspectPullRequest(repository: string, number: string): Promise<CommandResult> {
    return this.runGh(["pr", "view", number, "--repo", repository, "--json", "number,url,state,mergedAt,mergeCommit,closedAt,closedBy,reviewDecision"]);
  }

  createPullRequest(input: PullRequestInput): Promise<CommandResult> {
    return this.runGh([
      "pr", "create", "--repo", input.repository, "--base", input.base, "--head", input.head,
      "--title", input.title, "--body", input.body,
    ]);
  }

  updatePullRequest(input: PullRequestInput & { number: string }): Promise<CommandResult> {
    return this.runGh([
      "pr", "edit", input.number, "--repo", input.repository, "--base", input.base,
      "--title", input.title, "--body", input.body,
    ]);
  }

  listOpenPullRequests(repository: string, branch: string): Promise<CommandResult> {
    return this.runGh([
      "pr", "list", "--repo", repository, "--head", branch, "--state", "open", "--json", "number,url,body",
    ]);
  }

  clone(repositoryUrl: string, checkoutPath: string): Promise<CommandResult> {
    return this.runGit(["clone", "--origin", "origin", "--no-recurse-submodules", repositoryUrl, checkoutPath]);
  }

  remoteUrl(checkoutPath: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "remote", "get-url", "origin"]);
  }

  remoteRefs(checkoutPath: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "ls-remote", "--refs", "origin"]);
  }

  showRemoteFile(checkoutPath: string, branch: string, path: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "show", `origin/${branch}:${path}`]);
  }

  checkoutBranch(checkoutPath: string, branch: string, startPoint: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "checkout", "-B", branch, startPoint]);
  }

  checkoutOrphanBranch(checkoutPath: string, branch: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "checkout", "--orphan", branch]);
  }

  fetchBranch(checkoutPath: string, branch: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  }

  fetchDefaultBranch(checkoutPath: string, branch: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  }

  defaultBranchCommit(checkoutPath: string, branch: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "rev-parse", `origin/${branch}`]);
  }

  changedFiles(checkoutPath: string, fromCommit: string, toCommit: string): Promise<CommandResult> {
    return this.runGit([
      "-C", checkoutPath, "diff", "--name-status", fromCommit, toCommit, "--",
      ".openmembrane/manifest.json", ".openmembrane/memories",
    ]);
  }

  addOpenMembraneFiles(checkoutPath: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "add", "--", ".openmembrane"]);
  }

  commit(checkoutPath: string, message: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "commit", "-m", message]);
  }

  pushBranch(checkoutPath: string, branch: string): Promise<CommandResult> {
    return this.runGit(["-C", checkoutPath, "push", "origin", `HEAD:refs/heads/${branch}`]);
  }

  private runGh(args: readonly string[]): Promise<CommandResult> {
    return this.runner.run({ executable: "gh", args });
  }

  private runGit(args: readonly string[]): Promise<CommandResult> {
    return this.runner.run({ executable: "git", args });
  }
}

class ExecFileCommandRunner implements CommandRunner {
  async run(command: Command): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command.executable, [...command.args], {
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      if (typeof error !== "object" || error === null) {
        return { exitCode: -1, stdout: "", stderr: "", errorCode: "UNKNOWN" };
      }
      const commandError = error as { code?: string | number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof commandError.code === "number" ? commandError.code : -1,
        stdout: commandError.stdout ?? "",
        stderr: commandError.stderr ?? "",
        ...(typeof commandError.code === "string" ? { errorCode: commandError.code } : {}),
      };
    }
  }
}
