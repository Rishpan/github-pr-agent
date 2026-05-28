"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const get_file_js_1 = require("./tools/get_file.js");
const list_files_js_1 = require("./tools/list_files.js");
const logger_js_1 = require("./logger.js");
const server = new mcp_js_1.McpServer({
    name: "github-pr-agent",
    version: "0.1.0",
});
server.registerTool("get_file", {
    description: "Fetch raw file content from a public GitHub repository",
    inputSchema: get_file_js_1.GetFileSchema.shape,
}, async ({ repo, path }) => {
    const start = Date.now();
    logger_js_1.logger.info({ tool: "get_file", input: { repo, path } }, "tool_call_start");
    try {
        const content = await (0, get_file_js_1.getFile)({ repo, path });
        logger_js_1.logger.info({ tool: "get_file", durationMs: Date.now() - start }, "tool_call_success");
        return {
            content: [{ type: "text", text: content }],
        };
    }
    catch (err) {
        logger_js_1.logger.error({ tool: "get_file", input: { repo, path }, err }, "tool_call_error");
        throw err;
    }
});
server.registerTool("list_files", {
    description: "List files in a public GitHub repository",
    inputSchema: list_files_js_1.ListFilesSchema.shape,
}, async ({ repo, directory }) => {
    const start = Date.now();
    logger_js_1.logger.info({ tool: "list_files", input: { repo, directory } }, "tool_call_start");
    try {
        const files = await (0, list_files_js_1.listFiles)({ repo, directory });
        logger_js_1.logger.info({ tool: "list_files", durationMs: Date.now() - start }, "tool_call_success");
        return {
            content: [{ type: "text", text: files }],
        };
    }
    catch (err) {
        logger_js_1.logger.error({ tool: "list_files", input: { repo, directory }, err }, "tool_call_error");
        throw err;
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
