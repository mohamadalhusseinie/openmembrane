import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { OpenMembraneClientError } from "@openmembrane/client";
import type { ClientRequest, OpenMembraneClient } from "@openmembrane/client";

const exec = promisify(execFile);
type DaemonClient = Pick<OpenMembraneClient, "ingest" | "getProjectRules" | "getRelevantContext">;
type Messages = NonNullable<Awaited<ReturnType<PluginInput["client"]["session"]["messages"]>>["data"]>;
type Project = Pick<ClientRequest<"ingest">, "projectRoot" | "projectId"> & { projectRoot: string };
type Host = {
  client: {
    session: {
      messages: (options: Parameters<PluginInput["client"]["session"]["messages"]>[0]) =>
        ReturnType<PluginInput["client"]["session"]["messages"]>;
    };
    app: {
      log: (options: Parameters<PluginInput["client"]["app"]["log"]>[0]) =>
        ReturnType<PluginInput["client"]["app"]["log"]>;
    };
  };
};

export async function detectProject(directory: string, env: NodeJS.ProcessEnv): Promise<Project> {
  const projectRoot = resolve(directory || process.cwd());
  let projectId = basename(projectRoot);
  if (!projectId) {
    try {
      const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd: projectRoot, timeout: 2_000 });
      projectId = stdout.trim().replace(/\.git$/, "").split(/[/:\\]/).at(-1) ?? "";
    } catch {
      console.warn("[openmembrane] Could not detect a project name from the git remote.");
    }
  }
  projectId = env.OPENMEMBRANE_PROJECT_ID?.trim() || projectId;
  return { projectRoot, ...(projectId ? { projectId } : {}) };
}

export function sessionTranscript(messages: Messages): string {
  return messages.flatMap(({ info, parts }) => {
    const text = parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    return text.trim() ? [`${info.role}:\n${text}`] : [];
  }).join("\n\n");
}

export interface AdapterOptions {
  allowMemoryEgress?: boolean;
}

export function createHooks(input: Host, daemon: DaemonClient, project: Project, options: AdapterOptions = {}): Hooks {
  const sessions = new Map<string, Promise<void>>();
  const pending = new Set<Promise<void>>();
  let disposed = false;

  async function warn(operation: string, error: unknown): Promise<void> {
    const extra = error instanceof OpenMembraneClientError
      ? { code: error.code, diagnosticId: error.diagnosticId }
      : {};
    const message = `OpenMembrane ${operation} failed; the OpenCode session will continue.`;
    try {
      const result = await input.client.app.log({ body: { service: "openmembrane", level: "warn", message, extra } });
      if ("error" in result && result.error) console.warn(`[openmembrane] ${message}`);
    } catch {
      console.warn(`[openmembrane] ${message}`);
    }
  }

  async function messages(sessionID: string): Promise<Messages> {
    const result = await input.client.session.messages({
      path: { id: sessionID }, query: { directory: project.projectRoot },
    });
    if (("error" in result && result.error) || result.data === undefined) throw new Error("OpenCode session messages are unavailable.");
    return result.data;
  }

  return {
    "experimental.chat.system.transform": async ({ sessionID, model }, output) => {
      if (disposed || !options.allowMemoryEgress || sessionID === undefined) return;
      try {
        const history = await messages(sessionID);
        const user = [...history].reverse().find(({ info }) => info.role === "user");
        const query = user?.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim()
          || basename(project.projectRoot) || "Project context";
        const [rules, context] = await Promise.all([
          daemon.getProjectRules({ ...project, limit: 10 }),
          daemon.getRelevantContext({ ...project, query, limit: 5 }),
        ]);
        const memories = new Map([...rules.rules, ...context.memories].map((memory) => [memory.id, memory]));
        const budget = Math.max(0, Math.min(
          8_000,
          Math.floor(model.limit.context / 10),
          Math.floor(model.limit.context / 2) - Buffer.byteLength(output.system.join("\n\n"), "utf8") - 2,
        ));
        const lines = ["OpenMembrane project memory:"];
        let bytes = Buffer.byteLength(lines[0]!, "utf8");
        for (const memory of memories.values()) {
          const line = `- [${memory.type}] ${memory.content}`;
          const size = Buffer.byteLength(line, "utf8") + 1;
          if (bytes + size > budget) continue;
          lines.push(line);
          bytes += size;
        }
        if (lines.length > 1) {
          const block = lines.join("\n");
          const last = output.system.at(-1);
          if (last === undefined) output.system.push(block);
          else output.system[output.system.length - 1] = `${last}\n\n${block}`;
        }
      } catch (error) {
        await warn("context retrieval", error);
      }
    },
    event: async ({ event }) => {
      if (disposed) return;
      if (event.type !== "session.idle") return;
      const sessionID = event.properties.sessionID;
      const previous = sessions.get(sessionID) ?? Promise.resolve();
      const task = previous.then(async () => {
        try {
          const transcript = sessionTranscript(await messages(sessionID));
          if (!transcript) return;
          await daemon.ingest({ ...project, tool: "opencode", sessionId: sessionID, transcript });
        } catch (error) {
          await warn("session ingestion", error);
        }
      });
      sessions.set(sessionID, task);
      pending.add(task);
      try {
        await task;
      } finally {
        pending.delete(task);
        if (sessions.get(sessionID) === task) sessions.delete(sessionID);
      }
    },
    dispose: async () => {
      disposed = true;
      await Promise.all(pending);
      sessions.clear();
    },
  };
}
