import { mkdir, realpath } from "node:fs/promises";

export async function canonicalStoragePath(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}
