import path from "path";
import pino from "pino";
import { generateText, experimental_createMCPClient, type StepResult } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { loadAgentEnv } from "./load_env";
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  buildForcePrMessage,
  type AgentRequest,
} from "./prompt";
import {
  RepoModeError,
  createRepoModeState,
  wrapToolsForRepoMode,
} from "./repo_mode";

loadAgentEnv();

const logger = pino({ name: "github-pr-agent-agent" }, pino.destination(2));

type AgentTools = Awaited<
  ReturnType<Awaited<ReturnType<typeof experimental_createMCPClient>>["tools"]>
>;

function resolveModel() {
  const provider = process.env.LLM_PROVIDER?.toLowerCase();
  if (provider === "groq") {
    return groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
  }
  return google(process.env.GOOGLE_MODEL ?? "gemini-2.5-flash");
}

function resolveMaxSteps(): number {
  const parsed = Number.parseInt(process.env.AGENT_MAX_STEPS ?? "8", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

function isGroqProvider(): boolean {
  return process.env.LLM_PROVIDER?.toLowerCase() === "groq";
}

function resolveMaxRetries(): number {
  if (process.env.AGENT_MAX_RETRIES !== undefined) {
    const parsed = Number.parseInt(process.env.AGENT_MAX_RETRIES, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  // Gemini free tier is ~10–20 RPM; SDK retries on 429 multiply requests and make it worse.
  return isGroqProvider() ? 6 : 1;
}

function resolveRateLimitWaitMs(): number {
  const parsed = Number.parseInt(process.env.AGENT_RATE_LIMIT_WAIT_MS ?? "65000", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 65_000;
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted") ||
    lower.includes("free_tier")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRateLimitRetry(
  options: Parameters<typeof generateText>[0]
): Promise<Awaited<ReturnType<typeof generateText>>> {
  try {
    return await generateText(options);
  } catch (err) {
    if (!isRateLimitError(err)) {
      throw err;
    }
    const waitMs = resolveRateLimitWaitMs();
    logger.warn({ waitMs }, "llm_rate_limit_waiting");
    await sleep(waitMs);
    return generateText(options);
  }
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

function stepsCalledTool(
  steps: Array<StepResult<AgentTools>>,
  toolName: string
): boolean {
  return steps.some((step) =>
    step.toolCalls?.some((call) => call.toolName === toolName)
  );
}

/** Enough context to open a PR: issue + fork + file read. index_repo is optional (search only). */
function isReadyForDraftPr(
  steps: Array<StepResult<AgentTools>>,
  request: AgentRequest
): boolean {
  const hasIssueContext =
    request.mode === "issue" || stepsCalledTool(steps, "get_issue");
  return (
    hasIssueContext &&
    stepsCalledTool(steps, "fork_repo") &&
    stepsCalledTool(steps, "get_file")
  );
}

function extractDraftPrUrl(steps: Array<StepResult<AgentTools>>): string | undefined {
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "create_draft_pr") continue;
      const text = JSON.stringify(result.result);
      const match = text.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/);
      if (match) return match[0];
    }
  }
  return undefined;
}

function createStepLogger(onDraftPr: () => void) {
  return ({
    toolCalls,
    toolResults,
  }: {
    toolCalls?: Array<{ toolName: string; args: unknown }>;
    toolResults?: Array<{ toolName: string; result: unknown }>;
  }) => {
    for (const call of toolCalls ?? []) {
      logger.info({ tool: call.toolName, args: call.args }, "tool_call");
    }
    for (const toolResult of toolResults ?? []) {
      logger.info(
        { tool: toolResult.toolName, result: toolResult.result },
        "tool_result"
      );
      if (toolResult.toolName === "create_draft_pr") {
        onDraftPr();
      }
    }
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

    const rawTools = await mcpClient.tools();
    const repoModeState = createRepoModeState();
    const tools = wrapToolsForRepoMode(rawTools, request, repoModeState);
    const model = resolveModel();
    const maxSteps = resolveMaxSteps();
    const maxRetries = resolveMaxRetries();
    let draftPrCreated = false;

    logger.info(
      {
        provider: process.env.LLM_PROVIDER ?? "gemini",
        maxSteps,
        maxRetries,
        dryRun: request.dryRun,
        ollama: process.env.OLLAMA_HOST ?? "localhost",
      },
      "agent_start"
    );

    const onStepFinish = createStepLogger(() => {
      draftPrCreated = true;
    });

    const sharedGenerateOptions = {
      model,
      tools,
      maxRetries,
      system: SYSTEM_PROMPT,
      onStepFinish,
      experimental_prepareStep: async ({
        steps,
      }: {
        steps: Array<StepResult<AgentTools>>;
      }) => {
        if (request.dryRun || draftPrCreated) {
          return undefined;
        }
        if (
          isReadyForDraftPr(steps, request) &&
          !stepsCalledTool(steps, "create_draft_pr")
        ) {
          logger.info("forcing_create_draft_pr_step");
          return {
            toolChoice: { type: "tool" as const, toolName: "create_draft_pr" },
            experimental_activeTools: ["create_draft_pr"] as Array<
              keyof AgentTools
            >,
          };
        }
        return undefined;
      },
    };

    let result = await generateWithRateLimitRetry({
      ...sharedGenerateOptions,
      maxSteps,
      prompt: buildUserMessage(request),
    });

    let allSteps = result.steps;

    if (!request.dryRun && !draftPrCreated && isReadyForDraftPr(allSteps, request)) {
      logger.warn("create_draft_pr_missing_retrying");
      const continuation = await generateWithRateLimitRetry({
        ...sharedGenerateOptions,
        maxSteps: 2,
        messages: [
          ...result.response.messages,
          { role: "user", content: buildForcePrMessage(request) },
        ],
        toolChoice: { type: "tool", toolName: "create_draft_pr" },
        experimental_activeTools: ["create_draft_pr"],
      });
      allSteps = [...result.steps, ...continuation.steps];
      result = continuation;
    }

    if (!request.dryRun && !draftPrCreated) {
      throw new Error(
        "Agent finished without calling create_draft_pr. Check logs and re-run."
      );
    }

    const prUrl = extractDraftPrUrl(allSteps);
    if (prUrl) {
      return result.text?.trim()
        ? `${result.text.trim()}\n\nDraft PR: ${prUrl}`
        : `Draft PR created: ${prUrl}`;
    }

    return result.text;
  } catch (err) {
    if (err instanceof RepoModeError) {
      logger.info({ reason: err.exitReason }, "repo_mode_exit");
      return err.message;
    }
    throw err;
  } finally {
    if (mcpClient) {
      await mcpClient.close();
    }
  }
}
