import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { promisify } from "node:util";

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
