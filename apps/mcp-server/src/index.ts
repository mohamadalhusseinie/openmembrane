import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOpenMembrainContext } from "./context";
import { createOpenMembrainMcpServer } from "./server";

const context = createOpenMembrainContext();
const server = createOpenMembrainMcpServer(context);
await server.connect(new StdioServerTransport());
