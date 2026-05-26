import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetFileSchema, getFile } from "./tools/get_file.js";
import { ListFilesSchema, listFiles } from "./tools/list_files.js";
import { logger } from "./logger.js";

const server = new McpServer({
  name: "mcp-pr-agent",
  version: "0.1.0",
});

server.registerTool("get_file", {
  description: "Fetch raw file content from a public GitHub repository",
  inputSchema: GetFileSchema.shape,
}, async ({ repo, path }) => {
  const start = Date.now();
  logger.info({ tool: "get_file", input: { repo, path } }, "tool_call_start");
  try {
    const content = await getFile({ repo, path });
    logger.info({ tool: "get_file", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: content }],
    };
  } catch (err) {
    logger.error({ tool: "get_file", input: { repo, path }, err }, "tool_call_error");
    throw err;
  }
});

server.registerTool("list_files", {
  description: "List files in a public GitHub repository",
  inputSchema: ListFilesSchema.shape,
}, async ({ repo, directory }) => {
  const start = Date.now();
  logger.info({ tool: "list_files", input: { repo, directory } }, "tool_call_start");
  try {
    const files = await listFiles({ repo, directory });
    logger.info({ tool: "list_files", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: files }],
    };
  } catch (err) {
    logger.error({ tool: "list_files", input: { repo, directory }, err }, "tool_call_error");
    throw err;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
