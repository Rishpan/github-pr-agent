import "./load_env.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetFileSchema, getFile } from "./tools/get_file.js";
import { ListFilesSchema, listFiles } from "./tools/list_files.js";
import { IndexRepoSchema, indexRepo } from "./tools/index_repo.js";
import { SemanticSearchSchema, semanticSearch } from "./tools/semantic_search.js";
import { logger } from "./logger.js";

const server = new McpServer({
  name: "github-pr-agent",
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

server.registerTool("index_repo", {
  description:
    "Clone a GitHub repo, chunk and embed its code with Ollama, and upsert vectors into Chroma for semantic_search",
  inputSchema: IndexRepoSchema.shape,
}, async ({ repo }) => {
  const start = Date.now();
  logger.info({ tool: "index_repo", input: { repo } }, "tool_call_start");
  try {
    const result = await indexRepo({ repo });
    logger.info({ tool: "index_repo", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    logger.error({ tool: "index_repo", input: { repo }, err }, "tool_call_error");
    throw err;
  }
});

server.registerTool("semantic_search", {
  description:
    "Search indexed code in Chroma by natural-language query (run index_repo on the repo first)",
  inputSchema: SemanticSearchSchema.shape,
}, async ({ query, repo, topK }) => {
  const start = Date.now();
  logger.info({ tool: "semantic_search", input: { query, repo, topK } }, "tool_call_start");
  try {
    const results = await semanticSearch({ query, repo, topK });
    logger.info({ tool: "semantic_search", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: results }],
    };
  } catch (err) {
    logger.error({ tool: "semantic_search", input: { query, repo, topK }, err }, "tool_call_error");
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
