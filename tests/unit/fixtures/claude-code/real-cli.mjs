import { writeFileSync } from "node:fs";

if (process.argv[2] === "ingest" && process.env.CAPTURE_PID) {
  writeFileSync(process.env.CAPTURE_PID, String(process.pid));
}
await import("../../../../apps/mcp-server/src/index.ts");
