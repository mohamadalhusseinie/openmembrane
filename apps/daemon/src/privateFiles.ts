import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, open, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { DaemonLifecycleError } from "./errors";

const execFileAsync = promisify(execFile);

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function protectPath(path: string, directory = false): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
    throw new Error("Daemon private paths must not be symbolic links or special files.");
  }
  if (process.platform !== "win32") {
    if (info.uid !== process.getuid?.()) throw new Error("Daemon files must belong to the current user.");
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  // POSIX modes do not restrict Windows access. Replace the DACL, without inherited grants.
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
    "$ErrorActionPreference = 'Stop'",
    "$path = $env:OPENMEMBRANE_PRIVATE_PATH",
    "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
    `$acl = New-Object System.Security.AccessControl.${directory ? "DirectorySecurity" : "FileSecurity"}`,
    "$acl.SetOwner($sid)",
    "$acl.SetAccessRuleProtection($true, $false)",
    directory
      ? "$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')"
      : "$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')",
    "$acl.AddAccessRule($rule)",
    `[System.IO.${directory ? "Directory" : "File"}]::SetAccessControl($path, $acl)`,
  ].join("; ")], {
    env: { ...process.env, OPENMEMBRANE_PRIVATE_PATH: path },
    windowsHide: true,
    });
  } catch (cause) {
    const error = new DaemonLifecycleError("DAEMON_PRIVATE_PERMISSIONS", "The daemon could not restrict private-file permissions.");
    error.cause = cause;
    throw error;
  }
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await protectPath(path, true);
}

export async function writePrivateFile(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
  // Newly created files inherit the private run directory's DACL on Windows.
  if (process.platform !== "win32") await protectPath(path);
}

export async function replacePrivateFile(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (cause) {
      // Windows readers and scanners can briefly prevent atomic replacement.
      if (process.platform === "win32" && attempt < 5 && cause instanceof Error && "code" in cause &&
        (cause.code === "EPERM" || cause.code === "EBUSY")) {
        await delay(25 * 2 ** attempt);
        continue;
      }
      const error = new DaemonLifecycleError("DAEMON_PRIVATE_PUBLICATION", "The daemon could not publish its private discovery files.");
      error.cause = cause;
      throw error;
    }
  }
}
