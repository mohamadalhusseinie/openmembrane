import { argv } from "node:process";
import { parseArgs, USAGE } from "./cli/parseArgs";

const result = parseArgs(argv);

if (!result.ok) {
  process.stderr.write(`Error: ${result.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else {
  const cmd = result.value;

  try {
    switch (cmd.command) {
      case "help":
        process.stdout.write(USAGE);
        break;

      case "serve":
      case "start":
      case "stop":
      case "status": {
        const { runDaemonCommand, reportDaemonFailure } = await import("../../daemon/src/lifecycle");
        try {
          await runDaemonCommand(cmd.command);
        } catch (error) {
          await reportDaemonFailure(error);
        }
        break;
      }

      case "mcp": {
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
        const { createOpenMembraneContext } = await import("./context");
        const { createOpenMembraneMcpServer } = await import("./server");

        const context = await createOpenMembraneContext();
        const server = createOpenMembraneMcpServer(context);
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

      case "manage": {
        const { runManagement } = await import("./cli/manage");
        await runManagement(cmd);
        break;
      }
    }
  } catch (error) {
    const { OpenMembraneClientError } = await import("@openmembrane/client");
    if (!(error instanceof OpenMembraneClientError)) throw error;
    process.stderr.write(`Error [${error.code}]: ${error.message}${error.diagnosticId ? ` (diagnostic: ${error.diagnosticId})` : ""}\n`);
    process.exitCode = 1;
  }
}
