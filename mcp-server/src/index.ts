import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetFileSchema, getFile } from "./tools/get_file.js";

const server = new McpServer({
  name: "mcp-pr-agent",
  version: "0.1.0",
});

server.tool(
  "get_file",
  "Fetch raw file content from a public GitHub repository",
  GetFileSchema.shape,
  async (params) => {
    const content = await getFile(params);
    return {
      content: [{ type: "text", text: content }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
