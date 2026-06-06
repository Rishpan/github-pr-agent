import dotenv from "dotenv";
import path from "path";
import pino from "pino";
import { generateText, experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { SYSTEM_PROMPT, buildUserMessage, type AgentRequest } from "./prompt";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const logger = pino({ name: "github-pr-agent-agent" }, pino.destination(2));

function resolveModel() {
  const provider = process.env.LLM_PROVIDER?.toLowerCase();
  if (provider === "groq") {
    // 70b blows through Groq free-tier TPM fast; 8b is fine for tool routing.
    return groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
  }
  return google(process.env.GOOGLE_MODEL ?? "gemini-1.5-flash");
}

function resolveMaxSteps(): number {
  const parsed = Number.parseInt(process.env.AGENT_MAX_STEPS ?? "10", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function mcpServerLaunch(mcpCwd: string, mcpServerPath: string): {
  command: string;
  args: string[];
} {
  return {
    command: process.execPath,
    args: [
      path.join(mcpCwd, "node_modules", "tsx", "dist", "cli.mjs"),
      mcpServerPath,
    ],
  };
}

export async function runAgent(request: AgentRequest): Promise<string> {
  const mcpServerPath = path.resolve(__dirname, "../../mcp-server/src/index.ts");
  const mcpCwd = path.resolve(__dirname, "../../mcp-server");
  const { command, args } = mcpServerLaunch(mcpCwd, mcpServerPath);

  let mcpClient: Awaited<ReturnType<typeof experimental_createMCPClient>> | undefined;

  try {
    mcpClient = await experimental_createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command,
        args,
        cwd: mcpCwd,
        env: process.env as Record<string, string>,
      }),
    });

    const tools = await mcpClient.tools();
    const model = resolveModel();
    const maxSteps = resolveMaxSteps();

    const result = await generateText({
      model,
      tools,
      maxSteps,
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(request),
      onStepFinish: ({ toolCalls, toolResults }) => {
        for (const call of toolCalls ?? []) {
          logger.info({ tool: call.toolName, args: call.args }, "tool_call");
        }
        for (const toolResult of toolResults ?? []) {
          logger.info(
            { tool: toolResult.toolName, result: toolResult.result },
            "tool_result"
          );
        }
      },
    });

    return result.text;
  } finally {
    if (mcpClient) {
      await mcpClient.close();
    }
  }
}
