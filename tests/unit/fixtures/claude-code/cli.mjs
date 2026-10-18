import { appendFile } from "node:fs/promises";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
await appendFile(process.env.CAPTURE_RESULT, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  input: Buffer.concat(chunks).toString("utf8"),
}) + "\n");
if (process.env.FAIL_CAPTURE === process.argv[2]) {
  process.stderr.write("Fixture command failed.\n");
  process.exitCode = 1;
}
