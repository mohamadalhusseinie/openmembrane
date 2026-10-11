import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMissing, privateDirectory, protectPath, writePrivateFile } from "./privateFiles";

export interface DaemonLogger {
  write(event: string, diagnosticId?: string, code?: string): Promise<void>;
}

export async function createLogger(homeDir = homedir()): Promise<DaemonLogger> {
  const logsDir = join(homeDir, ".openmembrane", "logs");
  await privateDirectory(logsDir);
  const path = join(logsDir, "daemon.log");
  try {
    await protectPath(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    try {
      await writePrivateFile(path, "");
    } catch (createError) {
      if (!(createError instanceof Error && "code" in createError && createError.code === "EEXIST")) throw createError;
      await protectPath(path);
    }
  }
  return {
    async write(event, diagnosticId, code) {
      // Never log request bodies, authorization headers, gh output, or raw exception messages.
      await appendFile(path, `${JSON.stringify({ time: new Date().toISOString(), event, diagnosticId, code })}\n`, { mode: 0o600 });
    },
  };
}
