import { argv, exit, platform } from "node:process";
import { createReviewUiContext, type ReviewUiOptions } from "./context.js";
import { createReviewServer } from "./server.js";

function parseArgs(args: string[]): ReviewUiOptions & { open: boolean } {
  const options: ReviewUiOptions & { open: boolean } = { open: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--port":
        options.port = parseInt(args[++i] ?? "4800", 10);
        break;
      case "--timeout-ms": {
        const value = Number(args[++i]);
        if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
          throw new Error("--timeout-ms requires an integer between 1 and 2147483647.");
        }
        options.timeoutMs = value;
        break;
      }
      case "--no-open":
        options.open = false;
        break;
      case "--home": {
        const h = args[++i];
        if (h !== undefined) options.home = h;
        break;
      }
      case "--project": {
        const p = args[++i];
        if (p !== undefined) options.project = p;
      }
        break;
      case "--help":
      case "-h":
        console.log(`Usage: openmembrane-review-ui [options]

Options:
  --port <number>    Port to bind (default: 4800)
  --timeout-ms <ms>  Daemon request deadline (default: 1800000, or 30 minutes)
  --no-open          Don't auto-open browser
  --home <path>      Override OPENMEMBRANE_HOME
  --project <id>     Override project ID
  -h, --help         Show this help
`);
        exit(0);
    }
  }
  return options;
}

function openBrowser(url: string): void {
  const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
  import("node:child_process").then(({ exec }) => {
    exec(`${cmd} ${url}`);
  });
}

async function main(): Promise<void> {
  const options = parseArgs(argv.slice(2));
  const port = options.port ?? 4800;

  console.log("Starting OpenMembrane Review UI...");
  console.log(`  Storage: ${options.home ?? process.env["OPENMEMBRANE_HOME"] ?? "<cwd>/.openmembrane"}`);

  const ctx = await createReviewUiContext(options);
  const server = createReviewServer(ctx);

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`  Server: ${url}`);
    console.log(`  Project: ${ctx.projectId}`);
    console.log("\nPress Ctrl+C to stop.\n");

    if (options.open) {
      openBrowser(url);
    }
  });

  const shutdown = (): void => {
    console.log("\nShutting down...");
    server.close(() => {
      void ctx.close().then(() => exit(0), (error: unknown) => {
        console.error("Failed to close:", error);
        exit(1);
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("Failed to start:", err);
  exit(1);
});
