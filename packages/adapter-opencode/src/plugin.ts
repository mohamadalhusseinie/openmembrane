import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
    return text.trim() ? [`${info.role}: ${text}`] : [];
  }).join("\n\n");
}

export function createHooks(input: Host, daemon: DaemonClient, project: Project): Hooks {
  const sessions = new Map<string, { tail: Promise<void>; hash?: string }>();

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
    "experimental.chat.system.transform": async ({ sessionID }, output) => {
      if (sessionID === undefined) return;
      try {
        const history = await messages(sessionID);
        const user = [...history].reverse().find(({ info }) => info.role === "user");
        const query = user?.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim()
          || basename(project.projectRoot) || "Project context";
        const [rules, context] = await Promise.all([
          daemon.getProjectRules(project),
          daemon.getRelevantContext({ ...project, query }),
        ]);
        const memories = new Map([...rules.rules, ...context.memories].map((memory) => [memory.id, memory]));
        if (memories.size > 0) {
          output.system.push("OpenMembrane project memory:\n" +
            [...memories.values()].map((memory) => `- [${memory.type}] ${memory.content}`).join("\n"));
        }
      } catch (error) {
        await warn("context retrieval", error);
      }
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        sessions.delete(event.properties.info.id);
        return;
      }
      if (event.type !== "session.idle") return;
      const sessionID = event.properties.sessionID;
      let state = sessions.get(sessionID);
      if (state === undefined) {
        state = { tail: Promise.resolve() };
        sessions.set(sessionID, state);
      }
      const current = state;
      current.tail = current.tail.then(async () => {
        try {
          const transcript = sessionTranscript(await messages(sessionID));
          if (!transcript) return;
          const hash = createHash("sha256").update(transcript).digest("hex");
          if (hash === current.hash) return;
          await daemon.ingest({ ...project, tool: "opencode", sessionId: sessionID, transcript });
          current.hash = hash;
        } catch (error) {
          await warn("session ingestion", error);
        }
      });
      await current.tail;
    },
    dispose: async () => {
      await Promise.all([...sessions.values()].map((state) => state.tail));
      sessions.clear();
    },
  };
}
