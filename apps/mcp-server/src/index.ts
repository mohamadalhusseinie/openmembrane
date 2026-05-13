import { argv } from "node:process";
import { parseArgs, USAGE } from "./cli/parseArgs";

const result = parseArgs(argv);

if (!result.ok) {
  process.stderr.write(`Error: ${result.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else {
  const cmd = result.value;

  switch (cmd.command) {
    case "help":
      process.stdout.write(USAGE);
      break;

    case "serve": {
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const { createOpenMembrainContext } = await import("./context");
      const { createOpenMembrainMcpServer } = await import("./server");

      const context = createOpenMembrainContext();
      const server = createOpenMembrainMcpServer(context);
      await server.connect(new StdioServerTransport());
      break;
    }

    case "ingest": {
      const { runIngest } = await import("./cli/ingest");
      await runIngest(cmd);
      break;
    }

    case "context": {
      const { runContext } = await import("./cli/context");
      await runContext(cmd);
      break;
    }
  }
}
