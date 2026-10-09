import { request } from "node:http";
import type { DaemonEndpoint } from "@openmembrane/protocol";
import { daemonUnavailable, OpenMembraneClientError } from "./errors";

export interface HttpRequest {
  endpoint: DaemonEndpoint;
  method: string;
  path: string;
  body?: string;
  token?: string;
  timeoutMs: number;
}

export async function sendRequest(input: HttpRequest): Promise<{ status: number; value: unknown }> {
  return new Promise((resolve, reject) => {
    const connection = input.endpoint.transport === "socket"
      ? { socketPath: input.endpoint.socketPath }
      : { hostname: input.endpoint.host, port: input.endpoint.port };
    const req = request({
      ...connection, method: input.method, path: input.path, agent: false,
      headers: {
        accept: "application/json",
        ...(input.token === undefined ? {} : { authorization: `Bearer ${input.token}` }),
        ...(input.body === undefined ? {} : {
          "content-type": "application/json", "content-length": Buffer.byteLength(input.body),
        }),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          const error = new OpenMembraneClientError("E_INVALID_RESPONSE", "The daemon response exceeds the size limit.");
          reject(error);
          req.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      res.on("error", (cause) => {
        const error = new OpenMembraneClientError("E_TRANSPORT_ERROR", "The daemon response was interrupted.", { cause });
        reject(error);
        req.destroy(error);
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (cause) {
          reject(new OpenMembraneClientError("E_INVALID_RESPONSE", "The daemon returned invalid JSON.", { cause }));
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy(new OpenMembraneClientError("E_REQUEST_TIMEOUT", "The daemon request timed out."));
    }, input.timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", (cause: Error & { code?: string }) => {
      if (cause instanceof OpenMembraneClientError) reject(cause);
      else if (cause.code === "ECONNREFUSED" || cause.code === "ENOENT") reject(daemonUnavailable(cause));
      else reject(new OpenMembraneClientError("E_TRANSPORT_ERROR", "The daemon request failed.", { cause }));
    });
    req.end(input.body);
  });
}
