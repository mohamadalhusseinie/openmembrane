import { resolve } from "node:path";
import {
  daemonEndpointSchema, endpoints, errorResponseSchema, resolveDaemonEndpoint,
} from "@openmembrane/protocol";
import type { DaemonEndpoint, DaemonPathOptions, EndpointName, EndpointRequest, EndpointResponse } from "@openmembrane/protocol";
import { autoLaunchDaemon } from "./autoLaunch";
import type { AutoLaunchHook, AutoLaunchOptions } from "./autoLaunch";
import { daemonUnavailable, E_DAEMON_NOT_RUNNING, isMissingFile, OpenMembraneClientError } from "./errors";
import { loadDaemonToken } from "./token";
import { sendRequest } from "./transport";

type ProjectFields = "projectRoot" | "projectId" | "storageDir" | "storageBackend";
export type ClientRequest<K extends EndpointName> = Omit<EndpointRequest<K>, ProjectFields> &
  Partial<Pick<EndpointRequest<K>, Extract<keyof EndpointRequest<K>, ProjectFields>>>;

export interface OpenMembraneClientOptions extends AutoLaunchOptions {
  endpoint?: DaemonEndpoint;
  daemonPaths?: DaemonPathOptions;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  autoLaunch?: AutoLaunchHook;
}

export class OpenMembraneClient {
  private readonly options: OpenMembraneClientOptions;
  private readonly projectRoot: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs: number;
  private launchPromise: Promise<void> | undefined;

  constructor(options: OpenMembraneClientOptions = {}) {
    this.options = {
      ...options,
      ...(options.endpoint === undefined ? {} : { endpoint: daemonEndpointSchema.parse(options.endpoint) }),
      ...(options.daemonPaths === undefined ? {} : { daemonPaths: { ...options.daemonPaths } }),
    };
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.env = { ...(options.env ?? process.env) };
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new OpenMembraneClientError("E_CLIENT_CONFIG", "The request timeout must be a positive finite number.");
    }
  }

  async call<K extends EndpointName>(name: K, input: ClientRequest<K>): Promise<EndpointResponse<K>> {
    const endpoint = endpoints[name];
    const projectRoot = "projectRoot" in input && typeof input.projectRoot === "string"
      ? input.projectRoot : this.projectRoot;
    const request = endpoint.request.parse(endpoint.projectScoped ? {
      projectRoot,
      ...(this.env.OPENMEMBRANE_HOME ? { storageDir: resolve(projectRoot, this.env.OPENMEMBRANE_HOME) } : {}),
      ...(this.env.OPENMEMBRANE_PROJECT_ID ? { projectId: this.env.OPENMEMBRANE_PROJECT_ID } : {}),
      ...(this.env.OPENMEMBRANE_STORAGE_BACKEND ? { storageBackend: this.env.OPENMEMBRANE_STORAGE_BACKEND } : {}),
      ...input,
    } : input);
    try {
      return await this.invoke(name, request);
    } catch (error) {
      const missingToken = error instanceof OpenMembraneClientError && error.code === "E_TOKEN_UNAVAILABLE" && isMissingFile(error.cause);
      if (missingToken) {
        // A live daemon with a missing token is an authentication problem, not a reason to spawn another daemon.
        try {
          await this.invoke("health", {});
        } catch (healthError) {
          if (!(healthError instanceof OpenMembraneClientError) || healthError.origin === "daemon" || healthError.code !== E_DAEMON_NOT_RUNNING) throw healthError;
          return this.launchAndRetry(name, request, healthError);
        }
        throw error;
      }
      return this.launchAndRetry(name, request, error);
    }
  }

  private async launchAndRetry<K extends EndpointName>(name: K, input: unknown, error: unknown): Promise<EndpointResponse<K>> {
    if (!(error instanceof OpenMembraneClientError) || error.origin === "daemon" || error.code !== E_DAEMON_NOT_RUNNING || this.options.autoLaunch === undefined) {
      throw error;
    }
    if (this.launchPromise === undefined) {
      this.launchPromise = this.startDaemon(this.options.autoLaunch);
    }
    await this.launchPromise;
    return this.invoke(name, input);
  }

  private async startDaemon(launch: AutoLaunchHook): Promise<void> {
    try {
      await autoLaunchDaemon(
        launch,
        (remainingMs) => this.invoke("health", {}, Math.min(this.requestTimeoutMs, remainingMs)),
        this.options,
      );
    } finally {
      this.launchPromise = undefined;
    }
  }

  private async invoke<K extends EndpointName>(name: K, input: unknown, timeoutMs = this.requestTimeoutMs): Promise<EndpointResponse<K>> {
    const definition = endpoints[name];
    let connection: DaemonEndpoint;
    try {
      connection = this.options.endpoint ?? await resolveDaemonEndpoint(this.options.daemonPaths);
    } catch (cause) {
      if (isMissingFile(cause)) throw daemonUnavailable(cause);
      throw new OpenMembraneClientError("E_ENDPOINT_INVALID", "The daemon endpoint could not be resolved.", { cause });
    }
    const token = definition.projectScoped ? await loadDaemonToken(this.options.daemonPaths) : undefined;
    let path: string = definition.path;
    if ("idField" in definition) {
      const parsed = definition.request.parse(input);
      if (definition.idField === "candidateId" && "candidateId" in parsed) {
        path = path.replace(":id", encodeURIComponent(parsed.candidateId));
      } else if (definition.idField === "memoryId" && "memoryId" in parsed) {
        path = path.replace(":id", encodeURIComponent(parsed.memoryId));
      }
    }
    const json = JSON.stringify(input);
    if (definition.method === "GET" && definition.projectScoped) path += `?input=${encodeURIComponent(json)}`;
    const result = await sendRequest({
      endpoint: connection, method: definition.method, path, timeoutMs,
      ...(token === undefined ? {} : { token }),
      ...(definition.method === "GET" ? {} : { body: json }),
    });
    const error = errorResponseSchema.safeParse(result.value);
    if (error.success) {
      throw new OpenMembraneClientError(error.data.error.code, error.data.error.safeMessage, {
        diagnosticId: error.data.error.diagnosticId,
        origin: "daemon",
      });
    }
    if (result.status < 200 || result.status >= 300) {
      throw new OpenMembraneClientError("E_INVALID_RESPONSE", "The daemon returned an HTTP error without a valid error envelope.");
    }
    const response = definition.response.safeParse(result.value);
    if (!response.success) {
      throw new OpenMembraneClientError("E_INVALID_RESPONSE", "The daemon returned a response that does not match the protocol.", { cause: response.error });
    }
    return response.data as EndpointResponse<K>;
  }

  remember(input: ClientRequest<"remember">): Promise<EndpointResponse<"remember">> { return this.call("remember", input); }
  ingest(input: ClientRequest<"ingest">): Promise<EndpointResponse<"ingest">> { return this.call("ingest", input); }
  getProjectRules(input: ClientRequest<"getProjectRules"> = {}): Promise<EndpointResponse<"getProjectRules">> { return this.call("getProjectRules", input); }
  getRelevantContext(input: ClientRequest<"getRelevantContext">): Promise<EndpointResponse<"getRelevantContext">> { return this.call("getRelevantContext", input); }
  searchMemory(input: ClientRequest<"searchMemory"> = {}): Promise<EndpointResponse<"searchMemory">> { return this.call("searchMemory", input); }
  listMemoryCandidates(input: ClientRequest<"listMemoryCandidates"> = {}): Promise<EndpointResponse<"listMemoryCandidates">> { return this.call("listMemoryCandidates", input); }
  approveMemoryCandidate(input: ClientRequest<"approveMemoryCandidate">): Promise<EndpointResponse<"approveMemoryCandidate">> { return this.call("approveMemoryCandidate", input); }
  rejectMemoryCandidate(input: ClientRequest<"rejectMemoryCandidate">): Promise<EndpointResponse<"rejectMemoryCandidate">> { return this.call("rejectMemoryCandidate", input); }
  approveAllCandidates(input: ClientRequest<"approveAllCandidates"> = {}): Promise<EndpointResponse<"approveAllCandidates">> { return this.call("approveAllCandidates", input); }
  rejectAllCandidates(input: ClientRequest<"rejectAllCandidates"> = {}): Promise<EndpointResponse<"rejectAllCandidates">> { return this.call("rejectAllCandidates", input); }
  updateMemory(input: ClientRequest<"updateMemory">): Promise<EndpointResponse<"updateMemory">> { return this.call("updateMemory", input); }
  supersedeMemory(input: ClientRequest<"supersedeMemory">): Promise<EndpointResponse<"supersedeMemory">> { return this.call("supersedeMemory", input); }
  reviewStaleMemories(input: ClientRequest<"reviewStaleMemories"> = {}): Promise<EndpointResponse<"reviewStaleMemories">> { return this.call("reviewStaleMemories", input); }
  exportStaticMemoryFiles(input: ClientRequest<"exportStaticMemoryFiles"> = {}): Promise<EndpointResponse<"exportStaticMemoryFiles">> { return this.call("exportStaticMemoryFiles", input); }
  getDiagnostics(input: ClientRequest<"getDiagnostics"> = {}): Promise<EndpointResponse<"getDiagnostics">> { return this.call("getDiagnostics", input); }
  listAuditLog(input: ClientRequest<"listAuditLog"> = {}): Promise<EndpointResponse<"listAuditLog">> { return this.call("listAuditLog", input); }
  health(): Promise<EndpointResponse<"health">> { return this.call("health", {}); }
  configureGitHubTeamMode(input: ClientRequest<"configureGitHubTeamMode">): Promise<EndpointResponse<"configureGitHubTeamMode">> { return this.call("configureGitHubTeamMode", input); }
  getCollaborationStatus(input: ClientRequest<"getCollaborationStatus"> = {}): Promise<EndpointResponse<"getCollaborationStatus">> { return this.call("getCollaborationStatus", input); }
}
