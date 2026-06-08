import "./load_env.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GetFileSchema, getFile } from "./tools/get_file.js";
import { ListFilesSchema, listFiles } from "./tools/list_files.js";
import { IndexRepoSchema, indexRepo } from "./tools/index_repo.js";
import { SemanticSearchSchema, semanticSearch } from "./tools/semantic_search.js";
import { ForkRepoSchema, forkRepo } from "./tools/fork_repo.js";
import {
  CreateDraftPRSchema,
  createDraftPR,
} from "./tools/create_draft_pr.js";
import { GetIssueSchema, getIssue } from "./tools/get_issue.js";
import { ListIssuesSchema, listIssues } from "./tools/list_issues.js";
import { logger } from "./logger.js";

const server = new McpServer({
  name: "github-pr-agent",
  version: "0.1.0",
});

server.registerTool("get_file", {
  description:
    "Fetch file content from a public GitHub repository. Omit line range for full file; use startLine/endLine for a slice during investigation.",
  inputSchema: GetFileSchema.shape,
}, async ({ repo, path, startLine, endLine, contextLines }) => {
  const start = Date.now();
  logger.info(
    { tool: "get_file", input: { repo, path, startLine, endLine, contextLines } },
    "tool_call_start"
  );
  try {
    const content = await getFile({ repo, path, startLine, endLine, contextLines });
    logger.info({ tool: "get_file", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: content }],
    };
  } catch (err) {
    logger.error(
      { tool: "get_file", input: { repo, path, startLine, endLine, contextLines }, err },
      "tool_call_error"
    );
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
    "Clone a GitHub repo, chunk and embed its code with Ollama, and upsert vectors into Chroma for semantic_search. Skips if already indexed unless force=true.",
  inputSchema: IndexRepoSchema.shape,
}, async ({ repo, force }) => {
  const start = Date.now();
  logger.info({ tool: "index_repo", input: { repo, force } }, "tool_call_start");
  try {
    const result = await indexRepo({ repo, force });
    logger.info({ tool: "index_repo", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    logger.error({ tool: "index_repo", input: { repo, force }, err }, "tool_call_error");
    throw err;
  }
});

server.registerTool("fork_repo", {
  description:
    "Fork an upstream GitHub repository into the configured bot account. Idempotent: returns the existing fork if one already exists.",
  inputSchema: ForkRepoSchema.shape,
}, async ({ repo }) => {
  const start = Date.now();
  logger.info({ tool: "fork_repo", input: { repo } }, "tool_call_start");
  try {
    const result = await forkRepo({ repo });
    logger.info({ tool: "fork_repo", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    logger.error({ tool: "fork_repo", input: { repo }, err }, "tool_call_error");
    throw err;
  }
});

server.registerTool("create_draft_pr", {
  description:
    "Create a branch on the bot fork, apply search/replace edits, and open one draft PR. Pass fileChanges[] — each entry has filePath + edits[]. Multiple files land in the same PR.",
  inputSchema: CreateDraftPRSchema.shape,
}, async ({ repo, forkRepo, branch, fileChanges, title, description }) => {
  const start = Date.now();
  logger.info(
    {
      tool: "create_draft_pr",
      input: {
        repo,
        forkRepo,
        branch,
        filePaths: fileChanges.map((c) => c.filePath),
        title,
      },
    },
    "tool_call_start"
  );
  try {
    const result = await createDraftPR({
      repo,
      forkRepo,
      branch,
      fileChanges,
      title,
      description,
    });
    logger.info(
      { tool: "create_draft_pr", durationMs: Date.now() - start },
      "tool_call_success"
    );
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    logger.error(
      {
        tool: "create_draft_pr",
        input: { repo, forkRepo, branch, filePaths: fileChanges.map((c) => c.filePath), title },
        err,
      },
      "tool_call_error"
    );
    throw err;
  }
});

server.registerTool("get_issue", {
  description: "Fetch a GitHub issue and its comments from an upstream repository",
  inputSchema: GetIssueSchema.shape,
}, async ({ repo, issueNumber }) => {
  const start = Date.now();
  logger.info({ tool: "get_issue", input: { repo, issueNumber } }, "tool_call_start");
  try {
    const result = await getIssue({ repo, issueNumber });
    logger.info({ tool: "get_issue", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    logger.error({ tool: "get_issue", input: { repo, issueNumber }, err }, "tool_call_error");
    throw err;
  }
});

server.registerTool("list_issues", {
  description: "List open GitHub issues for an upstream repository, optionally filtered by label",
  inputSchema: ListIssuesSchema.shape,
}, async ({ repo, label }) => {
  const start = Date.now();
  logger.info({ tool: "list_issues", input: { repo, label } }, "tool_call_start");
  try {
    const result = await listIssues({ repo, label });
    logger.info({ tool: "list_issues", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    logger.error({ tool: "list_issues", input: { repo, label }, err }, "tool_call_error");
    throw err;
  }
});

server.registerTool("semantic_search", {
  description:
    "Search indexed code in Chroma by natural-language query (run index_repo on the repo first)",
  inputSchema: SemanticSearchSchema.shape,
}, async ({ query, repo, topK, excludeTests, preferSource }) => {
  const start = Date.now();
  logger.info(
    { tool: "semantic_search", input: { query, repo, topK, excludeTests, preferSource } },
    "tool_call_start"
  );
  try {
    const results = await semanticSearch({
      query,
      repo,
      topK,
      excludeTests,
      preferSource,
    });
    logger.info({ tool: "semantic_search", durationMs: Date.now() - start }, "tool_call_success");
    return {
      content: [{ type: "text", text: results }],
    };
  } catch (err) {
    logger.error(
      { tool: "semantic_search", input: { query, repo, topK, excludeTests, preferSource }, err },
      "tool_call_error"
    );
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
