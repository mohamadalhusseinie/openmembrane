import { updateHookSettings } from "../../adapter-hooks/src/settings";
export { updateInstructions } from "../../adapter-hooks/src/instructions";

export function hookCommand(args: string[], windows = process.platform === "win32"): string {
  if (windows) {
    // Codex may select cmd.exe or PowerShell. EncodedCommand is safe in both.
    const script = "& " + args.map((arg) => "'" + arg.replace(/'/g, "''") + "'").join(" ") + "; exit $LASTEXITCODE";
    return "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
  }
  return args.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'").join(" ");
}

export function updateSettings(content: string | null, command: string, install: boolean): string {
  return updateHookSettings(content, install,
    (handler) => handler.type === "command" && handler.statusMessage === "OpenMembrane Codex session capture",
    { SessionEnd: { type: "command", command, timeout: 3, statusMessage: "OpenMembrane Codex session capture" } });
}
