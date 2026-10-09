import { readFile } from "node:fs/promises";
import { resolveDaemonPaths } from "@openmembrane/protocol";
import type { DaemonPathOptions } from "@openmembrane/protocol";
import { OpenMembraneClientError } from "./errors";

export async function loadDaemonToken(options: DaemonPathOptions = {}): Promise<string> {
  let token: string;
  try {
    token = (await readFile(resolveDaemonPaths(options).tokenPath, "utf8")).trim();
  } catch (cause) {
    throw new OpenMembraneClientError("E_TOKEN_UNAVAILABLE", "The daemon authentication token could not be read.", { cause });
  }
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new OpenMembraneClientError("E_TOKEN_INVALID", "The daemon authentication token is invalid.");
  }
  return token;
}
